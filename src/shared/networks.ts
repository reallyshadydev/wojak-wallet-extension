import type { Network } from "belcoinjs-lib";

// WojakCoin chain parameters — must match wojakcore src/chainparams.cpp
export const wojakcoin: Network = {
  messagePrefix: "WojakCoin Signed Message:\n",
  // wojakcore has no segwit; bech32 is required by the Network type but unused
  bech32: "wjk",
  bip32: {
    public: 0x0488b21e,
    private: 0x0488ade4,
  },
  pubKeyHash: 73, // addresses start with 'W'
  scriptHash: 5,
  wif: 201,
};

export const wojakcoinTestnet: Network = {
  messagePrefix: "WojakCoin Signed Message:\n",
  bech32: "twjk",
  bip32: {
    public: 0x043587cf,
    private: 0x04358394,
  },
  pubKeyHash: 111, // addresses start with 'm' or 'n'
  scriptHash: 196,
  wif: 239,
};
