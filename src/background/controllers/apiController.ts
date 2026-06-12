import type {
  ApiUTXO,
  IAccountStats,
  ITransaction,
} from "@/shared/interfaces/api";
import {
  ContentDetailedInscription,
  ContentInscription,
  ContentInscriptionResopnse,
  FindInscriptionsByOutpointResponseItem,
  OrdInscriptionInfo,
} from "@/shared/interfaces/inscriptions";
import { IToken, ITransfer } from "@/shared/interfaces/token";
import { customFetch, fetchProps } from "@/shared/utils";
import { storageService } from "../services";
import { DEFAULT_FEES } from "@/shared/constant";
import { isValidTXID } from "@/ui/utils";

export interface UtxoQueryParams {
  hex?: boolean;
  amount?: number;
}

// 0.001 WJK outputs carry inscriptions; they must never be spent as funding.
// Used as a fallback guard in case the ord index briefly lags.
const CARRIER_SATS = 100_000;

export interface IApiController {
  getUtxos(
    address: string,
    params?: UtxoQueryParams
  ): Promise<ApiUTXO[] | undefined>;
  getSpendableUtxos(
    address: string,
    params?: { hex?: boolean }
  ): Promise<ApiUTXO[] | undefined>;
  getProtectedOutpoints(address: string): Promise<Set<string>>;
  pushTx(rawTx: string): Promise<{ txid?: string; error?: string }>;
  getTransactions(address: string): Promise<ITransaction[] | undefined>;
  getPaginatedTransactions(
    address: string,
    txid: string
  ): Promise<ITransaction[] | undefined>;
  getWJKPrice(): Promise<{ wojakcoin?: { usd: number } } | undefined>;
  getLastBlockBEL(): Promise<number | undefined>;
  getFees(): Promise<{ fast: number; slow: number } | undefined>;
  getAccountStats(address: string): Promise<IAccountStats | undefined>;
  getTokens(address: string): Promise<IToken[] | undefined>;
  getTransactionHex(txid: string): Promise<string | undefined>;
  getTransaction(txid: string): Promise<ITransaction | undefined>;
  getUtxoValues(outpoints: string[]): Promise<number[] | undefined>;
  getContentPaginatedInscriptions(
    address: string,
    page: number
  ): Promise<ContentInscriptionResopnse | undefined>;
  searchContentInscriptionByInscriptionId(
    inscriptionId: string
  ): Promise<ContentDetailedInscription | undefined>;
  searchContentInscriptionByInscriptionNumber(
    address: string,
    number: number
  ): Promise<ContentInscriptionResopnse | undefined>;
  getLocationByInscriptionId(
    inscriptionId: string
  ): Promise<{ location: string; owner: string } | undefined>;
  findInscriptionsByOutpoint(data: {
    outpoint: string;
    address: string;
  }): Promise<FindInscriptionsByOutpointResponseItem[] | undefined>;
}

type FetchType = <T>(
  props: Omit<fetchProps, "network">
) => Promise<T | undefined>;

class ApiController implements IApiController {
  private fetch: FetchType = async (p: Omit<fetchProps, "network">) => {
    try {
      return await customFetch({
        ...p,
        network: storageService.appState.network,
      });
    } catch {
      return;
    }
  };

  async getUtxos(address: string, params?: UtxoQueryParams) {
    const data = await this.fetch<ApiUTXO[]>({
      path: `/address/${address}/utxo`,
      params: params as Record<string, string>,
      service: "electrs",
    });
    if (Array.isArray(data)) {
      return data;
    }
  }

  // Outpoints ("txid:vout") that currently hold an inscription, per the ord
  // index. Authoritative source of what must NOT be spent as plain funds.
  async getProtectedOutpoints(address: string): Promise<Set<string>> {
    const res = await this.fetch<{ outputs?: string[] }>({
      path: `/address/${address}`,
      service: "content",
      headers: { Accept: "application/json" },
    });
    return new Set(res?.outputs ?? []);
  }

  // Like getUtxos but removes inscription-bearing outputs (ord) and 0.001 WJK
  // carriers (fallback), so callers can fund regular sends without ever
  // accidentally spending an inscription.
  async getSpendableUtxos(
    address: string,
    params?: { hex?: boolean }
  ): Promise<ApiUTXO[] | undefined> {
    const all = await this.getUtxos(address);
    if (!Array.isArray(all)) return all;

    const protectedOutpoints = await this.getProtectedOutpoints(address);
    const safe = all.filter(
      (u) =>
        !protectedOutpoints.has(`${u.txid}:${u.vout}`) &&
        u.value !== CARRIER_SATS
    );

    if (!params?.hex) return safe;

    const hexByTxid = new Map<string, string | undefined>();
    await Promise.all(
      [...new Set(safe.map((u) => u.txid))].map(async (txid) => {
        hexByTxid.set(txid, await this.getTransactionHex(txid));
      })
    );
    return safe.map((u) => ({ ...u, hex: u.hex ?? hexByTxid.get(u.txid) }));
  }

  async getFees() {
    const data = await this.fetch<Record<string, number>>({
      path: "/fee-estimates",
      service: "electrs",
    });
    if (data) {
      return {
        slow: "6" in data ? Number(data["6"].toFixed(0)) : DEFAULT_FEES.slow,
        fast:
          "2" in data ? Number(data["2"].toFixed(0)) + 1 : DEFAULT_FEES.fast,
      };
    }
  }

  async pushTx(rawTx: string) {
    const data = await this.fetch<string>({
      path: "/tx",
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
      },
      json: false,
      body: rawTx,
      service: "electrs",
    });
    if (isValidTXID(data) && data) {
      return {
        txid: data,
      };
    } else {
      return {
        error: data,
      };
    }
  }

  async getTransactions(address: string): Promise<ITransaction[] | undefined> {
    return await this.fetch<ITransaction[]>({
      path: `/address/${address}/txs`,
      service: "electrs",
    });
  }

  async getPaginatedTransactions(
    address: string,
    txid: string
  ): Promise<ITransaction[] | undefined> {
    try {
      return await this.fetch<ITransaction[]>({
        path: `/address/${address}/txs/chain/${txid}`,
        service: "electrs",
      });
    } catch (e) {
      return undefined;
    }
  }

  async getLastBlockBEL() {
    const data = await this.fetch<string>({
      path: "/blocks/tip/height",
      service: "electrs",
    });
    if (data) {
      return Number(data);
    }
  }

  async getWJKPrice() {
    const data = await this.fetch<{ price_usd: number }>({
      path: "/last-price",
      service: "electrs",
    });
    if (!data) {
      return undefined;
    }
    return {
      wojakcoin: {
        usd: data.price_usd,
      },
    };
  }

  async getAccountStats(address: string): Promise<IAccountStats | undefined> {
    try {
      return await this.fetch({
        path: `/address/${address}/stats`,
        service: "electrs",
      });
    } catch {
      return { amount: 0, count: 0, balance: 0 };
    }
  }

  private outpointToInscriptionId(
    outpoint: string | { txid: string; vout: number }
  ): string {
    if (typeof outpoint === "string") {
      if (outpoint.includes("i")) return outpoint;
      const colon = outpoint.lastIndexOf(":");
      if (colon > 0) {
        return `${outpoint.slice(0, colon)}i${outpoint.slice(colon + 1)}`;
      }
      return outpoint;
    }
    return `${outpoint.txid}i${outpoint.vout}`;
  }

  private mapIndexerTransfers(
    transfers:
      | Array<{ amount: string; outpoint: string | { txid: string; vout: number } }>
      | ITransfer[]
      | undefined
  ): ITransfer[] {
    if (!transfers?.length) return [];
    return transfers.map((t) => {
      if ("inscription_id" in t) return t;
      return {
        inscription_id: this.outpointToInscriptionId(t.outpoint),
        amount: String(t.amount),
      };
    });
  }

  private async getTokenBalanceFromIndexer(
    address: string,
    tick: string
  ): Promise<ITransfer[] | undefined> {
    const data = await this.fetch<{
      transfers?: Array<{
        amount: string;
        outpoint: string | { txid: string; vout: number };
      }>;
    }>({
      path: `/address/${address}/${encodeURIComponent(tick)}/balance`,
      service: "token",
    });
    const transfers = this.mapIndexerTransfers(data?.transfers);
    return transfers.length ? transfers : undefined;
  }

  // Fallback when the indexer list/balance APIs omit transfer outpoints.
  private async discoverTokenTransfersFromOrd(
    address: string,
    tick: string
  ): Promise<ITransfer[]> {
    const ids = await this.getOrdAddressInscriptionIds(address);
    if (!ids.length) return [];

    const normalizedTick = tick.toLowerCase();
    const transfers = await Promise.all(
      ids.map(async (id): Promise<ITransfer | undefined> => {
        const content = await this.fetch<string>({
          path: `/content/${id}`,
          service: "content",
          json: false,
        });
        if (!content) return;
        try {
          const parsed = JSON.parse(content) as {
            p?: string;
            op?: string;
            tick?: string;
            amt?: string | number;
          };
          if (
            parsed.p === "wjk-20" &&
            parsed.op === "transfer" &&
            String(parsed.tick ?? "").toLowerCase() === normalizedTick &&
            parsed.amt != null
          ) {
            return { inscription_id: id, amount: String(parsed.amt) };
          }
        } catch {
          return;
        }
      })
    );
    return transfers.filter((t): t is ITransfer => t !== undefined);
  }

  // Sum transfer-inscription amounts without float drift by scaling to the
  // largest decimal precision present, summing as integers, then rescaling.
  private sumTransferAmounts(transfers: ITransfer[]): string {
    if (!transfers.length) return "0";
    let maxDecimals = 0;
    for (const tr of transfers) {
      const dot = tr.amount.indexOf(".");
      if (dot >= 0) {
        maxDecimals = Math.max(maxDecimals, tr.amount.length - dot - 1);
      }
    }
    const scale = 10 ** maxDecimals;
    const totalScaled = transfers.reduce(
      (acc, tr) => acc + Math.round(Number(tr.amount) * scale),
      0
    );
    return (totalScaled / scale).toString();
  }

  private async resolveTokenTransfers(
    address: string,
    token: Pick<IToken, "tick" | "transfers" | "transfers_count">
  ): Promise<ITransfer[]> {
    const existing = this.mapIndexerTransfers(token.transfers);
    if (existing.length) return existing;
    if (!Number(token.transfers_count)) return [];

    const fromIndexer = await this.getTokenBalanceFromIndexer(
      address,
      token.tick
    );
    if (fromIndexer?.length) return fromIndexer;

    return await this.discoverTokenTransfersFromOrd(address, token.tick);
  }

  async getTokens(address: string): Promise<IToken[] | undefined> {
    const data = await this.fetch<IToken[]>({
      path: `/address/${address}/tokens`,
      service: "token",
    });
    if (!Array.isArray(data)) return data;

    return Promise.all(
      data.map(async (t) => {
        const transfers = await this.resolveTokenTransfers(address, t);
        // The resolved transfer inscriptions are the source of truth for the
        // transferable balance; the indexer's own field can lag/undercount.
        // Fall back to it only when no transfers could be resolved.
        const transferable_balance = transfers.length
          ? this.sumTransferAmounts(transfers)
          : t.transferable_balance ?? "0";
        return {
          ...t,
          transfers,
          transfers_count: t.transfers_count ?? transfers.length,
          transferable_balance,
        };
      })
    );
  }

  async getTransaction(txid: string) {
    return await this.fetch<ITransaction>({
      path: "/tx/" + txid,
      service: "electrs",
    });
  }

  async getTransactionHex(txid: string) {
    return await this.fetch<string>({
      path: "/tx/" + txid + "/hex",
      json: false,
      service: "electrs",
    });
  }

  async getUtxoValues(outpoints: string[]) {
    const result = await this.fetch<{ values: number[] }>({
      path: "/prev",
      body: JSON.stringify({ locations: outpoints }),
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      service: "electrs",
    });
    if (result?.values) return result.values;

    // Fallback for electrs servers without the custom /prev endpoint:
    // resolve each outpoint's value from the standard /tx/{txid} response.
    try {
      const uniqueTxids = [...new Set(outpoints.map((o) => o.split(":")[0]))];
      const txById = new Map(
        await Promise.all(
          uniqueTxids.map(
            async (txid) =>
              [txid, await this.getTransaction(txid)] as const
          )
        )
      );
      return outpoints.map((o) => {
        const [txid, voutStr] = o.split(":");
        const value = txById.get(txid)?.vout?.[Number(voutStr)]?.value;
        if (typeof value !== "number") throw new Error(`no value for ${o}`);
        return value;
      });
    } catch {
      return undefined;
    }
  }

  // --- vanilla ord (ord.wojakcoin.cash) helpers -------------------------
  // The deployed ord server is upstream ord, which has no account-based
  // search API. Instead it exposes JSON (with `Accept: application/json`) at
  // /address/<addr> (inscription ids owned) and /inscription/<id> (metadata).
  private fetchOrdJson = async <T>(path: string): Promise<T | undefined> => {
    return await this.fetch<T>({
      path,
      service: "content",
      headers: { Accept: "application/json" },
    });
  };

  private async getOrdInscriptionInfo(
    inscriptionId: string
  ): Promise<OrdInscriptionInfo | undefined> {
    return await this.fetchOrdJson<OrdInscriptionInfo>(
      `/inscription/${inscriptionId}`
    );
  }

  private async getOrdAddressInscriptionIds(
    address: string
  ): Promise<string[]> {
    const res = await this.fetchOrdJson<{ inscriptions?: string[] }>(
      `/address/${address}`
    );
    return res?.inscriptions ?? [];
  }

  async getContentPaginatedInscriptions(
    address: string,
    page: number
  ): Promise<ContentInscriptionResopnse | undefined> {
    const ids = await this.getOrdAddressInscriptionIds(address);
    const count = ids.length;
    if (!count) return { pages: 0, count: 0, inscriptions: [] };

    const pageSize = 6;
    const safePage = Math.max(1, page);
    const pageIds = ids.slice((safePage - 1) * pageSize, safePage * pageSize);

    const inscriptions = (
      await Promise.all(
        pageIds.map(async (id) => {
          const info = await this.getOrdInscriptionInfo(id);
          if (!info) return undefined;
          return {
            number: info.number,
            id: info.id,
            file_type: info.content_type,
            created: info.timestamp,
          } as ContentInscription;
        })
      )
    ).filter((i): i is ContentInscription => i !== undefined);

    return { pages: Math.ceil(count / pageSize), count, inscriptions };
  }

  async searchContentInscriptionByInscriptionId(inscriptionId: string) {
    const info = await this.getOrdInscriptionInfo(inscriptionId);
    if (!info) return undefined;
    return {
      number: info.number,
      id: info.id,
      file_type: info.content_type,
      mime: info.content_type,
      file_size: info.content_length,
      created: info.timestamp,
      creation_block: info.height,
      invalid_token_reason: null,
    } as ContentDetailedInscription;
  }

  async searchContentInscriptionByInscriptionNumber(
    address: string,
    number: number
  ) {
    const ids = await this.getOrdAddressInscriptionIds(address);
    const matches = (
      await Promise.all(ids.map((id) => this.getOrdInscriptionInfo(id)))
    ).filter((i): i is OrdInscriptionInfo => !!i && i.number === number);

    return {
      pages: 1,
      count: matches.length,
      inscriptions: matches.map((info) => ({
        number: info.number,
        id: info.id,
        file_type: info.content_type,
        created: info.timestamp,
      })),
    } as ContentInscriptionResopnse;
  }

  async getLocationByInscriptionId(inscriptionId: string) {
    const info = await this.getOrdInscriptionInfo(inscriptionId);
    if (!info) return undefined;
    // ord satpoint is "txid:vout:offset"; parseLocation() splits on "i".
    const [txid, vout, offset] = info.satpoint.split(":");
    return {
      location: `${txid}i${vout}i${offset ?? 0}`,
      owner: info.address,
    };
  }

  async findInscriptionsByOutpoint(data: {
    outpoint: string;
    address: string;
  }) {
    return await this.fetch<FindInscriptionsByOutpointResponseItem[]>({
      path: `/find_meta/${data.outpoint}?address=${data.address}`,
      service: "electrs",
    });
  }
}

export default new ApiController();
