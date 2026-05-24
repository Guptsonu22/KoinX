"use strict";

/**
 * Asset alias map — maps common aliases and alternate names to a canonical
 * uppercase asset symbol.
 *
 * Design decision: We keep a canonical form (e.g., "BTC") rather than full
 * names, since exchanges typically use tickers. Full names ("Bitcoin") are
 * mapped back to tickers for consistency.
 *
 * Add new aliases here as needed; the normalizer uses this table.
 */
const ASSET_ALIASES = {
  // Bitcoin
  BTC: "BTC",
  BITCOIN: "BTC",
  XBT: "BTC", // some exchanges use XBT

  // Ethereum
  ETH: "ETH",
  ETHEREUM: "ETH",

  // Tether
  USDT: "USDT",
  TETHER: "USDT",

  // USD Coin
  USDC: "USDC",
  "USD COIN": "USDC",

  // Binance Coin
  BNB: "BNB",
  "BINANCE COIN": "BNB",

  // Solana
  SOL: "SOL",
  SOLANA: "SOL",

  // Cardano
  ADA: "ADA",
  CARDANO: "ADA",

  // Ripple
  XRP: "XRP",
  RIPPLE: "XRP",

  // Dogecoin
  DOGE: "DOGE",
  DOGECOIN: "DOGE",

  // Polygon
  MATIC: "MATIC",
  POLYGON: "MATIC",

  // Avalanche
  AVAX: "AVAX",
  AVALANCHE: "AVAX",

  // Chainlink
  LINK: "LINK",
  CHAINLINK: "LINK",

  // Polkadot
  DOT: "DOT",
  POLKADOT: "DOT",

  // Litecoin
  LTC: "LTC",
  LITECOIN: "LTC",

  // Shiba Inu
  SHIB: "SHIB",
  "SHIBA INU": "SHIB",

  // Uniswap
  UNI: "UNI",
  UNISWAP: "UNI",

  // Dai
  DAI: "DAI",
};

/**
 * Resolve an asset string to its canonical ticker symbol.
 * Returns null if the asset is missing/empty.
 * Returns the uppercased raw value if not in the map (with UNKNOWN_ASSET warning).
 *
 * @param {string} asset - Raw asset string from CSV
 * @returns {{ normalized: string|null, isKnown: boolean }}
 */
const resolveAsset = (asset) => {
  if (!asset || typeof asset !== "string") {
    return { normalized: null, isKnown: false };
  }

  const key = asset.trim().toUpperCase();
  if (ASSET_ALIASES[key]) {
    return { normalized: ASSET_ALIASES[key], isKnown: true };
  }

  // Not in our map — return uppercased as-is, flag as unknown
  return { normalized: key, isKnown: false };
};

module.exports = { ASSET_ALIASES, resolveAsset };
