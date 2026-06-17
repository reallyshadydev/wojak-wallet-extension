import { Psbt } from "belcoinjs-lib";
import { wojakcoin, wojakcoinTestnet } from "@/shared/networks";
import { keyringService, storageService } from "../../services";
import "reflect-metadata/lite";
import permission from "@/background/services/permission";
import apiController from "../apiController";
import { IWojakProvider, NetworkType } from "wojak-sdk";
import { gptFeeCalculate, isTestnet } from "@/ui/utils";
import { ethErrors } from "eth-rpc-errors";
import walletController from "../walletController";
import {
  buildInscriptionChain,
  type ChainUtxo,
} from "../inscriber";
import type { Network } from "belcoinjs-lib";
import type { CreateTxProps } from "@/shared/interfaces/notification";

export interface InscribePayload {
  contentType: string;
  /** inscription bytes, hex-encoded */
  dataHex: string;
  /** optional receiver; defaults to the connected account */
  receiver?: string;
  feeRate: number;
}

export interface InscribeResult {
  txids: string[];
  inscriptionId: string;
}

/** A fully-signed, not-yet-broadcast inscription chain. */
export interface SignedInscription {
  inscriptionId: string;
  /** ordered signed tx hex; the last entry is the reveal */
  txs: string[];
  /** txid of the reveal (the tx a broadcaster waits to confirm) */
  revealTxid: string;
}

// 0.001 WJK carrier outputs are never spent as funding (they hold
// inscriptions); mirror the value the chain builder filters on.
const CARRIER_SATS = 100_000;

// Each mint is commit+reveal (2 txs) chained off the previous change output.
// Bitcoin-style mempools reject chains deeper than ~25 unconfirmed ancestors,
// so batch mints run in waves and wait for a confirmation between waves.
const MINTS_PER_WAVE = 10;
const CONFIRM_POLL_MS = 5_000;
const CONFIRM_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour per wave

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForTxConfirmation(txid: string): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < CONFIRM_TIMEOUT_MS) {
    const tx = await apiController.getTransaction(txid);
    if (tx?.status?.confirmed) return;
    await delay(CONFIRM_POLL_MS);
  }
  throw new Error(
    `Timed out waiting for ${txid} to confirm — try again to mint the rest`
  );
}

async function fetchChainUtxos(address: string): Promise<ChainUtxo[]> {
  // The electrs index can briefly lag behind the mempool, so a freshly
  // created change output may not appear immediately. If we only see carrier
  // outputs (nothing spendable), retry a few times before giving up — this
  // avoids a confusing "insufficient funds" when funds are really there.
  let rawUtxos: { txid: string; vout: number; value: number; hex?: string }[] =
    [];
  for (let attempt = 0; attempt < 4; attempt++) {
    rawUtxos = (await apiController.getUtxos(address)) ?? [];
    const hasSpendable = rawUtxos.some((u) => u.value !== CARRIER_SATS);
    if (hasSpendable) break;
    if (attempt < 3) await delay(1500);
  }

  if (!rawUtxos.length)
    throw new Error("No UTXOs found for this address (is it funded?)");

  if (!rawUtxos.some((u) => u.value !== CARRIER_SATS))
    throw new Error(
      "No spendable funds yet — your change output may still be confirming. " +
        "Wait a few seconds and try again."
    );

  const hexByTxid = new Map<string, string | undefined>();
  await Promise.all(
    [...new Set(rawUtxos.map((u) => u.txid))].map(async (txid) => {
      hexByTxid.set(txid, await apiController.getTransactionHex(txid));
    })
  );
  return rawUtxos.map((u) => {
    const hex = u.hex ?? hexByTxid.get(u.txid);
    if (!hex) throw new Error(`missing tx hex for ${u.txid}`);
    return { txid: u.txid, vout: u.vout, value: u.value, hex };
  });
}

function makeChainSigner(network: Network) {
  return async (psbtBase64: string): Promise<string> => {
    const psbt = Psbt.fromBase64(psbtBase64, { network });
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore non-segwit signing needs this flag (mirrors signTransaction)
    psbt.__CACHE.__UNSAFE_SIGN_NONSEGWIT = true;
    await keyringService.signPsbtWithoutFinalizing(psbt);
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    psbt.__CACHE.__UNSAFE_SIGN_NONSEGWIT = false;
    return psbt.toBase64();
  };
}

async function runInscribeChains(
  payloads: InscribePayload[],
  address: string,
  network: Network
): Promise<InscribeResult[]> {
  if (!payloads.length)
    throw ethErrors.rpc.invalidParams("Empty inscription batch");

  const publicKeyHex = keyringService.exportPublicKey(address);
  let utxos = await fetchChainUtxos(address);
  const signPsbt = makeChainSigner(network);
  const results: InscribeResult[] = [];

  for (let wave = 0; wave < payloads.length; wave += MINTS_PER_WAVE) {
    if (wave > 0) {
      const prev = results[results.length - 1];
      const lastRevealTxid = prev.txids[prev.txids.length - 1];
      await waitForTxConfirmation(lastRevealTxid);
      utxos = await fetchChainUtxos(address);
    }

    const wavePayloads = payloads.slice(wave, wave + MINTS_PER_WAVE);

    for (const payload of wavePayloads) {
      const { contentType, dataHex, receiver, feeRate } = payload;
      if (!contentType || !dataHex || !feeRate)
        throw ethErrors.rpc.invalidParams("Missing inscription params");

      const data = Buffer.from(dataHex, "hex");
      if (!data.length)
        throw ethErrors.rpc.invalidParams("Empty inscription data");

      const { txs, inscriptionId, remainingUtxos } = await buildInscriptionChain({
        contentType,
        data,
        receiverAddress: receiver || address,
        userAddress: address,
        userPubkeyHex: publicKeyHex,
        feeRate,
        utxos,
        network,
        signPsbt,
      });

      const txids: string[] = [];
      for (const tx of txs) {
        const res = await apiController.pushTx(tx.hex);
        if (!res?.txid) {
          const done = results.length;
          const detail = res?.error ?? "unknown error";
          const prefix =
            payloads.length > 1
              ? `Broadcast failed on inscription ${done + 1}/${payloads.length}` +
                (done > 0 ? ` (${done} already inscribed)` : "") +
                ". This can happen when too many unconfirmed transactions are " +
                "chained together — wait for a confirmation and inscribe the rest. "
              : "Broadcast failed. ";
          throw new Error(`${prefix}${detail}`);
        }
        txids.push(res.txid);
      }

      results.push({ txids, inscriptionId });
      utxos = remainingUtxos;
    }
  }

  return results;
}

/**
 * Builds and signs the entire batch up-front (no broadcasting) so an external
 * relay can broadcast the chain in waves without further user interaction.
 * The chain is self-funding: each inscription funds off the previous reveal's
 * change, so a broadcaster MUST confirm each wave before sending the next to
 * stay under the mempool ancestor limit.
 */
async function buildSignedBatch(
  payloads: InscribePayload[],
  address: string,
  network: Network
): Promise<SignedInscription[]> {
  if (!payloads.length)
    throw ethErrors.rpc.invalidParams("Empty inscription batch");

  const publicKeyHex = keyringService.exportPublicKey(address);
  let utxos = await fetchChainUtxos(address);
  const signPsbt = makeChainSigner(network);
  const out: SignedInscription[] = [];

  for (const payload of payloads) {
    const { contentType, dataHex, receiver, feeRate } = payload;
    if (!contentType || !dataHex || !feeRate)
      throw ethErrors.rpc.invalidParams("Missing inscription params");

    const data = Buffer.from(dataHex, "hex");
    if (!data.length)
      throw ethErrors.rpc.invalidParams("Empty inscription data");

    const { txs, inscriptionId, remainingUtxos } = await buildInscriptionChain({
      contentType,
      data,
      receiverAddress: receiver || address,
      userAddress: address,
      userPubkeyHex: publicKeyHex,
      feeRate,
      utxos,
      network,
      signPsbt,
    });

    out.push({
      inscriptionId,
      txs: txs.map((t) => t.hex),
      revealTxid: txs[txs.length - 1].txid,
    });
    utxos = remainingUtxos;
  }

  return out;
}

type IProviderController<
  K extends keyof IWojakProvider = keyof Omit<IWojakProvider, "on">
> = {
  [P in K]: (p: Payload<P>) => ReturnType<IWojakProvider[P]>;
};

type Payload<P extends keyof IWojakProvider> = {
  session: { origin: string };
  data: {
    params: Parameters<IWojakProvider[P]>;
  };
  approvalRes?: any;
};

// @ts-ignore
class ProviderController implements IProviderController {
  connect = async () => {
    if (
      storageService.currentWallet === undefined ||
      !storageService.currentAccount
    )
      return "";
    const account = storageService.currentAccount.address;
    return account ?? "";
  };

  @Reflect.metadata("SAFE", true)
  getVersion = async () => {
    return process.env.VERSION ?? "0.0.1";
  };

  @Reflect.metadata("SAFE", true)
  getNetwork = async (): Promise<NetworkType> => {
    if (!storageService.appState.isReady) {
      await storageService.init();
    }
    return isTestnet(storageService.appState.network) ? "testnet" : "mainnet";
  };

  @Reflect.metadata("CONNECTED", true)
  getBalance = async () => {
    if (!storageService.currentAccount?.address)
      throw ethErrors.provider.chainDisconnected("Account not found");

    const stats = await apiController.getAccountStats(
      storageService.currentAccount.address
    );

    if (typeof stats === "undefined")
      throw ethErrors.provider.chainDisconnected();

    return stats.balance;
  };

  @Reflect.metadata("CONNECTED", true)
  getAccountName = async () => {
    if (!storageService.currentAccount?.address)
      throw ethErrors.provider.chainDisconnected("Account not found");

    return storageService.currentAccount.name;
  };

  @Reflect.metadata("SAFE", true)
  isConnected = async ({ session: { origin } }: Payload<"isConnected">) => {
    return permission.siteIsConnected(origin);
  };

  @Reflect.metadata("CONNECTED", true)
  getAccount = async () => {
    if (!storageService.currentAccount?.address)
      throw ethErrors.provider.chainDisconnected("Account not found");

    return storageService.currentAccount.address;
  };

  @Reflect.metadata("CONNECTED", true)
  calculateFee = async ({
    data: {
      params: [base64, feeRate],
    },
  }: Payload<"calculateFee">) => {
    const psbt = Psbt.fromBase64(base64);
    keyringService.signPsbt(psbt);
    let txSize = psbt.extractTransaction(true).toBuffer().length;
    psbt.data.inputs.forEach((v) => {
      if (v.finalScriptWitness) {
        txSize -= v.finalScriptWitness.length * 0.75;
      }
    });
    const fee = Math.ceil(txSize * feeRate);
    return fee;
  };

  @Reflect.metadata("CONNECTED", true)
  getPublicKey = async () => {
    if (!storageService.currentAccount?.address)
      throw ethErrors.provider.chainDisconnected("Account not found");

    return keyringService.exportPublicKey(
      storageService.currentAccount.address
    );
  };

  @Reflect.metadata("APPROVAL", ["SignText"])
  signMessage = async ({
    data: {
      params: [text],
    },
  }: Payload<"signMessage">) => {
    if (!storageService.currentAccount?.address)
      throw ethErrors.provider.chainDisconnected("Account not found");

    const message = keyringService.signMessage({
      from: storageService.currentAccount.address,
      data: text,
    });
    return message;
  };

  @Reflect.metadata("APPROVAL", ["CreateTx"])
  createTx = async ({
    data: {
      params: [payload],
    },
  }: { data: { params: [CreateTxProps] }; approvalRes?: any }) => {
    if (!storageService.currentAccount?.address)
      throw ethErrors.provider.chainDisconnected("Account not found");

    const network = storageService.appState.network;

    // Inscription-aware: exclude inscription outputs from dapp-funded sends.
    const utxos = await apiController.getSpendableUtxos(
      storageService.currentAccount.address
    );

    if ((utxos?.length ?? 0) > 500) throw new Error("Consolidate utxos");

    if (!utxos?.length) throw new Error("Not enough utxos");

    const tx = await keyringService.sendBEL({
      to: payload.to,
      amount: payload.amount,
      receiverToPayFee: payload.receiverToPayFee,
      feeRate: payload.feeRate,
      opReturn: payload.opReturn,
      opReturnIsHex: payload.opReturnIsHex,
      utxos,
      network,
    });
    const psbt = Psbt.fromHex(tx);
    return psbt.extractTransaction(true).toHex();
  };

  @Reflect.metadata("APPROVAL", ["signPsbt"])
  signPsbt = async ({
    data: {
      params: [psbtBase64, options],
    },
  }: Payload<"signPsbt">) => {
    const psbt = Psbt.fromBase64(psbtBase64);
    await keyringService.signPsbtWithoutFinalizing(psbt, options?.toSignInputs);
    return psbt.toBase64();
  };

  @Reflect.metadata("APPROVAL", ["inscribeTransfer"])
  inscribeTransfer = async (data: Payload<"inscribeTransfer">) => {
    return { mintedAmount: data.approvalRes?.mintedAmount };
  };

  @Reflect.metadata("APPROVAL", ["multiPsbtSign"])
  multiPsbtSign = async ({
    data: {
      params: [items],
    },
  }: Payload<"multiPsbtSign">) => {
    return await Promise.all(
      items.map(async (f) => {
        const psbt = Psbt.fromBase64(f.psbtBase64);
        await keyringService.signPsbtWithoutFinalizing(
          psbt,
          f.options?.toSignInputs
        );
        return psbt.toBase64();
      })
    );
  };

  @Reflect.metadata("APPROVAL", ["inscribe"])
  inscribe = async ({
    data: {
      params: [payload],
    },
  }: {
    data: { params: [InscribePayload] };
    approvalRes?: any;
  }) => {
    if (!storageService.currentAccount?.address)
      throw ethErrors.provider.chainDisconnected("Account not found");

    const [result] = await runInscribeChains(
      [payload],
      storageService.currentAccount.address,
      storageService.appState.network
    );
    return result;
  };

  @Reflect.metadata("APPROVAL", ["inscribeBatch"])
  inscribeBatch = async ({
    data: {
      params: [payloads],
    },
  }: {
    data: { params: [InscribePayload[]] };
    approvalRes?: any;
  }) => {
    if (!storageService.currentAccount?.address)
      throw ethErrors.provider.chainDisconnected("Account not found");

    const results = await runInscribeChains(
      payloads,
      storageService.currentAccount.address,
      storageService.appState.network
    );
    return { results };
  };

  // Sign the whole batch behind one approval but DON'T broadcast — returns the
  // signed chain so a relay can broadcast in waves after the page is closed.
  @Reflect.metadata("APPROVAL", ["inscribeBatch"])
  inscribeBatchPresign = async ({
    data: {
      params: [payloads],
    },
  }: {
    data: { params: [InscribePayload[]] };
    approvalRes?: any;
  }) => {
    if (!storageService.currentAccount?.address)
      throw ethErrors.provider.chainDisconnected("Account not found");

    const inscriptions = await buildSignedBatch(
      payloads,
      storageService.currentAccount.address,
      storageService.appState.network
    );
    return {
      inscriptions,
      receiver:
        payloads[0]?.receiver ?? storageService.currentAccount.address,
      network: isTestnet(storageService.appState.network)
        ? "testnet"
        : "mainnet",
    };
  };

  @Reflect.metadata("APPROVAL", ["switchNetwork"])
  switchNetwork = async ({
    data: {
      params: [networkStr],
    },
  }: Payload<"switchNetwork">) => {
    if (!storageService.currentWallet || !storageService.currentAccount) {
      throw ethErrors.provider.chainDisconnected("Account not found");
    }
    const network =
      networkStr === "testnet" ? wojakcoinTestnet : wojakcoin;
    await walletController.switchNetwork(network);
    return networkStr;
  };
}

export default new ProviderController();
