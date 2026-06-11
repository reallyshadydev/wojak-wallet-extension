import { ITransferToken } from "@/shared/interfaces/token";
import {
  buildInscriptionChain,
  type ChainUtxo,
} from "@/background/controllers/inscriber";
import { useControllersState } from "../states/controllerState";
import toast from "react-hot-toast";
import { t } from "i18next";
import { isValidTXID, ss } from "../utils";
import { useAppState } from "../states/appState";
import { useGetCurrentAccount } from "../states/walletState";
import type apiController from "@/background/controllers/apiController";

const WJK20_CONTENT_TYPE = "text/plain;charset=utf-8";
const CARRIER_SATS = 100_000;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchChainUtxos(
  api: typeof apiController,
  address: string
): Promise<ChainUtxo[]> {
  let rawUtxos: { txid: string; vout: number; value: number; hex?: string }[] =
    [];
  for (let attempt = 0; attempt < 4; attempt++) {
    rawUtxos = (await api.getUtxos(address)) ?? [];
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
      hexByTxid.set(txid, await api.getTransactionHex(txid));
    })
  );

  return rawUtxos.map((u) => {
    const hex = u.hex ?? hexByTxid.get(u.txid);
    if (!hex) throw new Error(`missing tx hex for ${u.txid}`);
    return { txid: u.txid, vout: u.vout, value: u.value, hex };
  });
}

export const useInscribeTransferToken = () => {
  const { apiController, keyringController } = useControllersState(
    ss(["apiController", "keyringController"])
  );
  const currentAccount = useGetCurrentAccount();
  const { network } = useAppState(ss(["network"]));

  return async (data: ITransferToken, feeRate: number) => {
    if (!currentAccount?.address) return;

    const utxos = await fetchChainUtxos(apiController, currentAccount.address);
    const publicKeyHex = await keyringController.exportPublicKey(
      currentAccount.address
    );

    const { txs } = await buildInscriptionChain({
      contentType: WJK20_CONTENT_TYPE,
      data: Buffer.from(JSON.stringify(data), "utf8"),
      receiverAddress: currentAccount.address,
      userAddress: currentAccount.address,
      userPubkeyHex: publicKeyHex,
      feeRate,
      utxos,
      network,
      signPsbt: (psbtBase64) =>
        keyringController.signPsbtWithoutFinalizingBase64(psbtBase64),
    });

    const txIds: string[] = [];
    for (const tx of txs) {
      const res = await apiController.pushTx(tx.hex);
      txIds.push(res?.txid ?? "");
    }

    if (txIds.every(isValidTXID))
      toast.success(t("inscriptions.transfer_inscribed"));
    else toast.error(t("inscriptions.failed_inscribe_transfer"));
  };
};
