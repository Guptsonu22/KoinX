"use strict";

/**
 * Transaction type normalization map.
 *
 * Key design decision:
 *   TRANSFER_IN (exchange perspective) and TRANSFER_OUT (user perspective)
 *   represent the SAME transaction viewed from opposite sides. Both normalize
 *   to "TRANSFER" so the matching engine can pair them correctly.
 *
 *   Similarly, DEPOSIT (exchange) ↔ TRANSFER_IN (user) and
 *   WITHDRAWAL (exchange) ↔ TRANSFER_OUT (user) are common patterns.
 */
const TYPE_MAP = {
  // Buy / Sell
  BUY: "BUY",
  PURCHASE: "BUY",

  SELL: "SELL",
  SALE: "SELL",

  // Transfers — both perspectives collapse to TRANSFER
  TRANSFER: "TRANSFER",
  TRANSFER_IN: "TRANSFER",
  TRANSFER_OUT: "TRANSFER",
  TRANSFERIN: "TRANSFER",
  TRANSFEROUT: "TRANSFER",

  // Deposit / Withdrawal — exchange terminology for transfers
  DEPOSIT: "TRANSFER",
  WITHDRAWAL: "TRANSFER",
  WITHDRAW: "TRANSFER",

  // Staking rewards
  STAKING: "STAKING",
  STAKING_REWARD: "STAKING",
  STAKING_REWARDS: "STAKING",
  REWARD: "STAKING",

  // Interest / Earnings
  INTEREST: "INTEREST",
  EARN: "INTEREST",

  // Trade (generic)
  TRADE: "TRADE",
  SWAP: "TRADE",
  EXCHANGE: "TRADE",

  // Fees (sometimes tracked separately)
  FEE: "FEE",

  // Airdrops
  AIRDROP: "AIRDROP",

  // Mining rewards
  MINING: "MINING",
  MINING_REWARD: "MINING",
};

/**
 * Resolve a raw transaction type string to its canonical type.
 *
 * @param {string} type - Raw type string from CSV
 * @returns {{ normalized: string|null, isKnown: boolean }}
 */
const resolveType = (type) => {
  if (!type || typeof type !== "string") {
    return { normalized: null, isKnown: false };
  }

  // Normalize whitespace, convert to uppercase, replace spaces with underscores
  const key = type.trim().toUpperCase().replace(/\s+/g, "_");

  if (TYPE_MAP[key]) {
    return { normalized: TYPE_MAP[key], isKnown: true };
  }

  // Unknown type — return uppercased as-is
  return { normalized: key, isKnown: false };
};

module.exports = { TYPE_MAP, resolveType };
