// Legacy P2SH commit/reveal-chain inscriber (Bells/Doge "ordinals.js" style),
// ported from the wojak-inscribe site so the wallet can build, sign and
// broadcast a full inscription chain behind a single user approval.
//
// WojakCoin is pre-segwit, so this uses the P2SH envelope scheme (NOT the
// taproot inscriber in bells-inscriber, which is invalid on this chain).
import {
  Psbt,
  address as baddress,
  crypto as bcrypto,
  type Network,
} from "belcoinjs-lib";

// --- chain constants (mirror wojak-inscribe/src/config.ts) ----------------
const TX_VERSION = 1;
const MAX_CHUNK_LEN = 240;
const MAX_PAYLOAD_LEN = 1500;
const INSCRIPTION_OUTPUT_SATS = 100_000;
// Anything below this is uneconomical to keep as a separate output; fold it
// into the fee. Kept low (a normal dust threshold) so we never burn a large
// change amount — burning change previously starved the reveal tx of funds.
const DUST_SATS = 1_000;

// --- raw-script helpers (mirror wojak-inscribe/src/script.ts) -------------
const OP_DROP = 0x75;
const OP_TRUE = 0x51;
const OP_CHECKSIGVERIFY = 0xad;
const OP_HASH160 = 0xa9;
const OP_EQUAL = 0x87;

function pushData(data: Buffer): Buffer {
  if (data.length === 0) return Buffer.from([0]);
  if (data.length <= 75)
    return Buffer.concat([Buffer.from([data.length]), data]);
  if (data.length <= 255)
    return Buffer.concat([Buffer.from([76, data.length]), data]);
  const len = Buffer.alloc(2);
  len.writeUInt16LE(data.length);
  return Buffer.concat([Buffer.from([77]), len, data]);
}

function pushNumber(n: number): Buffer {
  if (n === 0) return Buffer.from([0]);
  if (n >= 1 && n <= 16) return Buffer.from([0x50 + n]);
  if (n < 128) return Buffer.from([1, n]);
  return Buffer.from([2, n % 256, Math.floor(n / 256)]);
}

const pushText = (s: string): Buffer => pushData(Buffer.from(s, "utf8"));

function inscriptionChunks(contentType: string, data: Buffer): Buffer[] {
  const parts: Buffer[] = [];
  for (let i = 0; i < data.length; i += MAX_CHUNK_LEN) {
    parts.push(data.subarray(i, Math.min(i + MAX_CHUNK_LEN, data.length)));
  }
  const chunks: Buffer[] = [
    pushText("ord"),
    pushNumber(parts.length),
    pushText(contentType),
  ];
  parts.forEach((part, n) => {
    chunks.push(pushNumber(parts.length - n - 1));
    chunks.push(pushData(part));
  });
  return chunks;
}

/** <pubkey> OP_CHECKSIGVERIFY OP_DROP*n OP_TRUE */
function buildLockScript(pubkey: Buffer, numDrops: number): Buffer {
  return Buffer.concat([
    pushData(pubkey),
    Buffer.from([OP_CHECKSIGVERIFY]),
    Buffer.alloc(numDrops, OP_DROP),
    Buffer.from([OP_TRUE]),
  ]);
}

/** OP_HASH160 <hash160(redeem)> OP_EQUAL */
function p2shScriptPubKey(redeem: Buffer): Buffer {
  const h = bcrypto.hash160(redeem);
  return Buffer.concat([
    Buffer.from([OP_HASH160, 20]),
    h,
    Buffer.from([OP_EQUAL]),
  ]);
}

/** scriptSig spending the P2SH: <partial pushes> <sig> <redeem> */
function buildUnlockScript(
  partial: Buffer,
  signatureWithHashType: Buffer,
  redeem: Buffer
): Buffer {
  return Buffer.concat([
    partial,
    pushData(signatureWithHashType),
    pushData(redeem),
  ]);
}

// --- types ----------------------------------------------------------------
export interface ChainUtxo {
  txid: string;
  vout: number;
  value: number;
  hex: string;
}

export interface SignedTx {
  txid: string;
  hex: string;
}

export interface InscribeChainParams {
  contentType: string;
  data: Buffer;
  /** address that receives the inscription */
  receiverAddress: string;
  /** connected wallet address (funding + change) */
  userAddress: string;
  /** connected wallet compressed pubkey (hex) */
  userPubkeyHex: string;
  feeRate: number; // sat/vB
  utxos: ChainUtxo[];
  network: Network;
  /** signer — returns a signed (NOT finalized) PSBT base64 */
  signPsbt: (psbtBase64: string) => Promise<string>;
  onProgress?: (msg: string) => void;
}

interface PendingP2sh {
  txid: string;
  hex: string;
  lock: Buffer;
  partial: Buffer;
}

const P2PKH_INPUT_VBYTES = 148;
const P2PKH_OUTPUT_VBYTES = 34;
const TX_OVERHEAD_VBYTES = 10;

function p2shInputVbytes(partial: Buffer, lock: Buffer): number {
  const scriptSig = partial.length + (72 + 2) + (lock.length + 3);
  return 36 + 4 + 3 + scriptSig;
}

function estimateFee(
  numWalletInputs: number,
  p2shInput: PendingP2sh | null,
  numOutputs: number,
  feeRate: number
): number {
  let vbytes = TX_OVERHEAD_VBYTES + numWalletInputs * P2PKH_INPUT_VBYTES;
  if (p2shInput) vbytes += p2shInputVbytes(p2shInput.partial, p2shInput.lock);
  vbytes += numOutputs * P2PKH_OUTPUT_VBYTES;
  return Math.max(1, vbytes * feeRate);
}

class UtxoPool {
  utxos: ChainUtxo[];

  constructor(utxos: ChainUtxo[]) {
    // Never spend potential inscription carriers (exactly 100k sats).
    this.utxos = utxos
      .filter((u) => u.value !== INSCRIPTION_OUTPUT_SATS)
      .sort((a, b) => b.value - a.value);
  }

  take(amount: number): ChainUtxo[] {
    const selected: ChainUtxo[] = [];
    let total = 0;
    for (const u of this.utxos) {
      if (total >= amount) break;
      selected.push(u);
      total += u.value;
    }
    if (total < amount) {
      throw new Error(
        `Insufficient funds: need ${amount} sats, have ${this.total()} spendable`
      );
    }
    this.utxos = this.utxos.filter((u) => !selected.includes(u));
    return selected;
  }

  add(utxo: ChainUtxo) {
    this.utxos.push(utxo);
    this.utxos.sort((a, b) => b.value - a.value);
  }

  total(): number {
    return this.utxos.reduce((acc, u) => acc + u.value, 0);
  }
}

/** Builds and signs the full chain (does NOT broadcast). */
export async function buildInscriptionChain(
  params: InscribeChainParams
): Promise<{ txs: SignedTx[]; inscriptionId: string; remainingUtxos: ChainUtxo[] }> {
  const {
    contentType,
    data,
    receiverAddress,
    userAddress,
    userPubkeyHex,
    feeRate,
    network,
    signPsbt,
    onProgress,
  } = params;

  if (!data.length) throw new Error("no data to inscribe");
  const pubkey = Buffer.from(userPubkeyHex, "hex");
  const chunks = inscriptionChunks(contentType, data);
  const pool = new UtxoPool(params.utxos);
  const txs: SignedTx[] = [];
  let prev: PendingP2sh | null = null;

  // Plan partials up-front so we know the tx count for progress reporting.
  const partials: { chunks: Buffer[]; partial: Buffer }[] = [];
  {
    const queue = [...chunks];
    let first = true;
    while (queue.length) {
      const partialChunks: Buffer[] = [];
      if (first) {
        partialChunks.push(queue.shift()!);
        first = false;
      }
      let partial = Buffer.concat(partialChunks);
      while (partial.length <= MAX_PAYLOAD_LEN && queue.length) {
        partialChunks.push(queue.shift()!);
        if (queue.length) partialChunks.push(queue.shift()!);
        partial = Buffer.concat(partialChunks);
      }
      if (partial.length > MAX_PAYLOAD_LEN) {
        queue.unshift(partialChunks.pop()!);
        queue.unshift(partialChunks.pop()!);
        partial = Buffer.concat(partialChunks);
      }
      partials.push({ chunks: partialChunks, partial });
    }
  }
  const totalTxs = partials.length + 1;

  const signAndFinalize = async (
    psbt: Psbt,
    p2sh: PendingP2sh | null,
    label: string
  ): Promise<SignedTx> => {
    onProgress?.(label);
    const signedB64 = await signPsbt(psbt.toBase64());
    const signed = Psbt.fromBase64(signedB64, { network });

    signed.data.inputs.forEach((_, i) => {
      if (i === 0 && p2sh) {
        signed.finalizeInput(0, (_idx: number, input: any) => {
          const sig = input.partialSig?.[0]?.signature;
          if (!sig) throw new Error("wallet did not sign the inscription input");
          return {
            finalScriptSig: buildUnlockScript(p2sh.partial, sig, p2sh.lock),
            finalScriptWitness: undefined,
          };
        });
      } else {
        signed.finalizeInput(i);
      }
    });

    const tx = signed.extractTransaction(true);
    return { txid: tx.getId(), hex: tx.toHex() };
  };

  const addFunding = (
    psbt: Psbt,
    p2sh: PendingP2sh | null,
    baseOutputsValue: number,
    numBaseOutputs: number
  ) => {
    const p2shCarry = p2sh ? INSCRIPTION_OUTPUT_SATS : 0;
    let inputs: ChainUtxo[] = [];
    let fee = 0;
    for (let n = 1; n <= 25; n++) {
      fee = estimateFee(n, p2sh, numBaseOutputs + 1, feeRate);
      const needed = baseOutputsValue + fee - p2shCarry;
      inputs = pool.take(Math.max(needed, 1));
      if (inputs.length <= n) break;
      inputs.forEach((u) => pool.add(u));
      fee = estimateFee(inputs.length, p2sh, numBaseOutputs + 1, feeRate);
    }
    const totalIn = inputs.reduce((acc, u) => acc + u.value, 0) + p2shCarry;
    fee = estimateFee(inputs.length, p2sh, numBaseOutputs + 1, feeRate);

    for (const u of inputs) {
      psbt.addInput({
        hash: u.txid,
        index: u.vout,
        nonWitnessUtxo: Buffer.from(u.hex, "hex"),
      });
    }
    let change = totalIn - baseOutputsValue - fee;
    if (change >= DUST_SATS) {
      // Never emit a change output equal to the carrier value, or UtxoPool
      // would mistake the recycled change for an inscription carrier and
      // refuse to spend it. Shift the extra sat into the fee instead.
      if (change === INSCRIPTION_OUTPUT_SATS) change -= 1;
      psbt.addOutput({ address: userAddress, value: change });
      return { change, inputs };
    }
    return { change: 0, inputs };
  };

  // --- commit / carrier chain ---------------------------------------------
  for (let i = 0; i < partials.length; i++) {
    const { chunks: partialChunks, partial } = partials[i];
    const lock = buildLockScript(pubkey, partialChunks.length);
    const spk = p2shScriptPubKey(lock);

    const psbt = new Psbt({ network });
    psbt.setVersion(TX_VERSION);

    if (prev) {
      psbt.addInput({
        hash: prev.txid,
        index: 0,
        nonWitnessUtxo: Buffer.from(prev.hex, "hex"),
        redeemScript: prev.lock,
      });
    }
    psbt.addOutput({ script: spk, value: INSCRIPTION_OUTPUT_SATS });

    const { change } = addFunding(psbt, prev, INSCRIPTION_OUTPUT_SATS, 1);
    const signed = await signAndFinalize(
      psbt,
      prev,
      `Transaction ${i + 1}/${totalTxs}`
    );

    if (change > 0) {
      const voutIndex = psbt.txOutputs.length - 1;
      pool.add({
        txid: signed.txid,
        vout: voutIndex,
        value: change,
        hex: signed.hex,
      });
    }
    txs.push(signed);
    prev = { txid: signed.txid, hex: signed.hex, lock, partial };
  }

  // --- final reveal: deliver the inscription to the receiver --------------
  {
    const psbt = new Psbt({ network });
    psbt.setVersion(TX_VERSION);
    psbt.addInput({
      hash: prev!.txid,
      index: 0,
      nonWitnessUtxo: Buffer.from(prev!.hex, "hex"),
      redeemScript: prev!.lock,
    });
    const receiverScript = baddress.toOutputScript(receiverAddress, network);
    psbt.addOutput({ script: receiverScript, value: INSCRIPTION_OUTPUT_SATS });

    const { change } = addFunding(psbt, prev, INSCRIPTION_OUTPUT_SATS, 1);
    const signed = await signAndFinalize(
      psbt,
      prev,
      `Transaction ${totalTxs}/${totalTxs}`
    );

    // Track the reveal's change so a following inscription in a batch can
    // spend it (the carrier output is intentionally left out of the pool).
    if (change > 0) {
      const voutIndex = psbt.txOutputs.length - 1;
      pool.add({
        txid: signed.txid,
        vout: voutIndex,
        value: change,
        hex: signed.hex,
      });
    }
    txs.push(signed);
  }

  return {
    txs,
    inscriptionId: `${txs[txs.length - 1].txid}i0`,
    remainingUtxos: pool.utxos,
  };
}

/** Number of carrier txs (~1500 payload bytes each) + reveal. */
export function estimateChainTxCount(byteLength: number): number {
  return Math.max(2, Math.ceil(byteLength / 1500) + 1);
}
