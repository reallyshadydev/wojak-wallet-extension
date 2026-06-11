import { ethErrors, serializeError } from "eth-rpc-errors";
import { EventEmitter } from "events";

import BroadcastChannelMessage from "@/shared/utils/message/broadcastChannelMessage";

import PushEventHandlers from "./pushEventHandlers";
import ReadyPromise from "./readyPromise";
import { $, domReadyCall } from "./utils";
import type {
  SendBEL,
  SignPsbtOptions,
} from "@/background/services/keyring/types";
import { INintondoProvider, NetworkType } from "nintondo-sdk";

const script = document.currentScript;
const channelName = script?.getAttribute("channel") || "WOJAKWALLET";

export interface Interceptor {
  onRequest?: (data: any) => any;
  onResponse?: (res: any, data: any) => any;
}

interface StateProvider {
  accounts: string[] | null;
  isConnected: boolean;
  isUnlocked: boolean;
  initialized: boolean;
  isPermanentlyDisconnected: boolean;
}

interface WojakProviderProps {
  maxListeners?: number;
  onInit?: () => void;
}

export class WojakProvider
  extends EventEmitter
  implements INintondoProvider
{
  _selectedAddress: string | null = null;
  _network: string | null = null;
  _isConnected = false;
  _initialized = false;
  _isUnlocked = false;

  _state: StateProvider = {
    accounts: null,
    isConnected: false,
    isUnlocked: false,
    initialized: false,
    isPermanentlyDisconnected: false,
  };

  private _pushEventHandlers: PushEventHandlers;
  private _requestPromise = new ReadyPromise(0);

  private _bcm = new BroadcastChannelMessage(channelName);

  constructor({ maxListeners = 100, onInit }: WojakProviderProps) {
    super();
    this.setMaxListeners(maxListeners);
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.initialize(onInit);
    this._pushEventHandlers = new PushEventHandlers(this);
  }

  initialize = async (onInit?: () => void) => {
    document.addEventListener(
      "visibilitychange",
      this._requestPromiseCheckVisibility
    );

    this._bcm.connect().on("message", this._handleBackgroundMessage);
    domReadyCall(async () => {
      const origin = window.top?.location.origin;
      const icon =
        ($('head > link[rel~="icon"]') as HTMLLinkElement)?.href ||
        ($('head > meta[itemprop="image"]') as HTMLMetaElement)?.content;

      const name =
        document.title ||
        ($('head > meta[name="title"]') as HTMLMetaElement)?.content ||
        origin;

      try {
        await this._bcm.request({
          method: "tabCheckin",
          params: { icon, name, origin },
        });
        if (onInit) {
          onInit();
        }
      } catch {
        //
      }
    });

    try {
      const { network, accounts, isUnlocked }: any = await this._request({
        // @ts-expect-error method is hidden
        method: "getProviderState",
      });
      if (isUnlocked) {
        this._isUnlocked = true;
        this._state.isUnlocked = true;
      }
      this.emit("connect", {});
      this._pushEventHandlers.networkChanged({
        network,
      });

      this._pushEventHandlers.accountsChanged(accounts);
    } catch {
      //
    } finally {
      this._initialized = true;
      this._state.initialized = true;
      this.emit("_initialized");
    }
  };

  private _requestPromiseCheckVisibility = () => {
    if (document.visibilityState === "visible") {
      this._requestPromise.check(1);
    } else {
      this._requestPromise.uncheck(1);
    }
  };

  private _handleBackgroundMessage = ({
    event,
    data,
  }: {
    event: string;
    data: any;
  }) => {
    if (
      this._pushEventHandlers[event as keyof typeof this._pushEventHandlers]
    ) {
      return (
        this._pushEventHandlers[
          event as keyof typeof this._pushEventHandlers
        ] as any
      )(data);
    }

    this.emit(event, data);
  };

  async _request<
    K extends keyof INintondoProvider = keyof INintondoProvider,
    T extends INintondoProvider[K] = INintondoProvider[K]
  >(data: { method: K; params?: Parameters<T> }) {
    if (!data) {
      throw ethErrors.rpc.invalidRequest();
    }

    this._requestPromiseCheckVisibility();

    return this._requestPromise.call(async () => {
      try {
        return await this._bcm.request(data);
      } catch (e) {
        throw serializeError(e);
      }
    }) as ReturnType<T>;
  }

  // public methods
  connect = async () => {
    return this._request({
      method: "connect",
    });
  };

  getBalance = async () => {
    return this._request({
      method: "getBalance",
    });
  };

  getAccountName = async () => {
    return this._request({
      method: "getAccountName",
    });
  };

  isConnected = async () => {
    return this._request({
      method: "isConnected",
    });
  };

  getAccount = async () => {
    return this._request({
      method: "getAccount",
    });
  };

  getPublicKey = async () => {
    return this._request({
      method: "getPublicKey",
    });
  };

  createTx = async (data: SendBEL) => {
    return this._request({
      method: "createTx",
      params: [data],
    });
  };

  signMessage = async (text: string) => {
    return this._request({
      method: "signMessage",
      params: [text],
    });
  };

  calculateFee = async (hex: string, feeRate: number) => {
    return this._request({
      method: "calculateFee",
      params: [hex, feeRate],
    });
  };

  signPsbt = async (psbtBase64: string, options?: SignPsbtOptions) => {
    return this._request({
      method: "signPsbt",
      params: [psbtBase64, options],
    });
  };

  inscribeTransfer = async (tick: string) => {
    return this._request({
      method: "inscribeTransfer",
      params: [tick],
    });
  };

  multiPsbtSign = async (
    data: { psbtBase64: string; options: SignPsbtOptions }[]
  ) => {
    return this._request({
      method: "multiPsbtSign",
      params: [data],
    });
  };

  inscribe = async (payload: {
    contentType: string;
    dataHex: string;
    receiver?: string;
    feeRate: number;
  }): Promise<{ txids: string[]; inscriptionId: string }> => {
    return this._request({
      // not part of the upstream INintondoProvider type yet
      method: "inscribe" as any,
      params: [payload] as any,
    }) as unknown as Promise<{ txids: string[]; inscriptionId: string }>;
  };

  inscribeBatch = async (
    payloads: {
      contentType: string;
      dataHex: string;
      receiver?: string;
      feeRate: number;
    }[]
  ): Promise<{
    results: { txids: string[]; inscriptionId: string }[];
  }> => {
    return this._request({
      method: "inscribeBatch" as any,
      params: [payloads] as any,
    }) as unknown as Promise<{
      results: { txids: string[]; inscriptionId: string }[];
    }>;
  };

  inscribeBatchPresign = async (
    payloads: {
      contentType: string;
      dataHex: string;
      receiver?: string;
      feeRate: number;
    }[]
  ): Promise<{
    inscriptions: { inscriptionId: string; txs: string[]; revealTxid: string }[];
    receiver: string;
    network: string;
  }> => {
    return this._request({
      method: "inscribeBatchPresign" as any,
      params: [payloads] as any,
    }) as unknown as Promise<{
      inscriptions: {
        inscriptionId: string;
        txs: string[];
        revealTxid: string;
      }[];
      receiver: string;
      network: string;
    }>;
  };

  getVersion = async () => {
    return this._request({
      method: "getVersion",
    });
  };

  switchNetwork = async (network: NetworkType) => {
    return this._request({
      method: "switchNetwork",
      params: [network],
    });
  };

  getNetwork = async () => {
    return this._request({
      method: "getNetwork",
    });
  };
}

declare global {
  interface Window {
    wojak: INintondoProvider;
  }
}

const provider = new WojakProvider({
  onInit: () => {
    Object.defineProperty(window, "wojak", {
      value: new Proxy(provider, {
        deleteProperty: () => true,
      }),
      writable: false,
    });
    window.dispatchEvent(new Event("wojak#initialized"));
  },
});
