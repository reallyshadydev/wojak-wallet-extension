import { isTestnet } from "@/ui/utils";
import { Network } from "belcoinjs-lib";
import { wojakcoin, wojakcoinTestnet } from "@/shared/networks";
import { AddressType } from "bellhdw/src/hd/types";

export const KEYRING_TYPE = {
  HdKeyring: "HD Key Tree",
  SimpleKeyring: "Simple Key Pair",
  Empty: "Empty",
};

export const IS_CHROME = /Chrome\//i.test(navigator.userAgent);

export const IS_LINUX = /linux/i.test(navigator.userAgent);

export const IS_WINDOWS = /windows/i.test(navigator.userAgent);

export const NETOWRKS: { name: string; network: Network }[] = [
  { name: "MAINNET", network: wojakcoin },
  { name: "TESTNET", network: wojakcoinTestnet },
];

export const ADDRESS_TYPES: {
  value: AddressType;
  label: string;
  name: string;
  hdPath: string;
}[] = [
  // WojakCoin (wojakcore) is a pre-segwit chain — only legacy P2PKH addresses
  // are valid. Do not re-add P2WPKH/P2TR unless the chain activates segwit.
  {
    value: AddressType.P2PKH,
    label: "P2PKH",
    name: "Legacy (P2PKH)",
    hdPath: "m/44'/0'/0'/0",
  },
];

export const EVENTS = {
  broadcastToUI: "broadcastToUI",
  broadcastToBackground: "broadcastToBackground",
  SIGN_FINISHED: "SIGN_FINISHED",
  WALLETCONNECT: {
    STATUS_CHANGED: "WALLETCONNECT_STATUS_CHANGED",
    INIT: "WALLETCONNECT_INIT",
    INITED: "WALLETCONNECT_INITED",
  },
};

// electrs REST API — serves /blocks/tip/height etc. at the root (no /api prefix)
const WOJAKCOIN_API_URL = process.env.API_URL ?? "https://api.wojakcoin.cash";

// ord server — serves /content/<id> and /preview/<id>
const CONTENT_URL = process.env.CONTENT_URL ?? "https://ord.wojakcoin.cash";
const HISTORY_URL = process.env.HISTORY_URL ?? "https://ord.wojakcoin.cash";

// WJK-20 token indexer (bel-20-indexer fork) — serves /address/<addr>/tokens etc.
// Hosted instance; override with TOKEN_API_URL for local development.
const TOKEN_API_URL =
  process.env.TOKEN_API_URL ?? "https://wjk20.wojakcoin.cash";

export const WOJAKCOIN_URL = "https://wojakcoin.cash";
export const SPLITTER_URL = WOJAKCOIN_URL + "/splitter";

// Block explorer — serves /tx/<txid> for viewing transactions.
export const EXPLORER_URL =
  process.env.EXPLORER_URL ?? "https://explorer.wojakcoin.cash";
export const explorerTxUrl = (txId: string) => `${EXPLORER_URL}/tx/${txId}`;

const TESTNET_WOJAKCOIN_API_URL =
  process.env.TESTNET_API_URL ?? "https://testnet.wojakcoin.cash/electrs";
const TESTNET_CONTENT_URL =
  process.env.TESTNET_CONTENT_URL ?? "https://testnet.wojakcoin.cash/api/pub";

const TESTNET_TOKEN_API_URL =
  process.env.TESTNET_TOKEN_API_URL ?? TOKEN_API_URL;

export const getContentUrl = (network: Network) =>
  isTestnet(network) ? TESTNET_CONTENT_URL : CONTENT_URL;

export const getTokenApiUrl = (network: Network) =>
  isTestnet(network) ? TESTNET_TOKEN_API_URL : TOKEN_API_URL;

export const getApiUrl = (network: Network) =>
  isTestnet(network) ? TESTNET_WOJAKCOIN_API_URL : WOJAKCOIN_API_URL;

export const getHistoryUrl = (network: Network) =>
  isTestnet(network) ? TESTNET_HISTORY_URL : HISTORY_URL;

const TESTNET_HISTORY_URL =
  process.env.TESTNET_HISTORY_URL ?? "https://testnet.wojakcoin.cash/history/pub";

export const DEFAULT_FEES = {
  fast: 500,
  slow: 20,
};

export const DEFAULT_SERVICE_FEE = 1_000_000;

export const DEFAULT_HD_PATH = "m/44'/0'/0'/0";
