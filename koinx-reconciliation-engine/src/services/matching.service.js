"use strict";

const Transaction = require("../models/Transaction");
const {
  isTimestampWithinTolerance,
  isQuantityWithinTolerance,
  getTimestampDiffSeconds,
  getQuantityDiffPct,
  computeMatchScore,
} = require("../utils/tolerance");
const logger = require("../utils/logger");

/**
 * Core matching engine.
 *
 * Matching pipeline (in order):
 *  1. EXACT ID MATCH   — both sides share the same transactionId
 *  2. FUZZY MATCH      — same normalizedAsset + normalizedType + timestamp window +
 *                        quantity tolerance; best candidate wins (lowest score)
 *  3. Remaining rows   — classified as UNMATCHED
 *
 * After each phase, matched exchange transactions are marked to prevent
 * duplicate pairing.
 *
 * @param {string} runId
 * @param {{ timestampToleranceSeconds: number, quantityTolerancePct: number }} config
 * @returns {Promise<{
 *   matched: MatchResult[],
 *   conflicting: MatchResult[],
 *   unmatchedUser: Transaction[],
 *   unmatchedExchange: Transaction[]
 * }>}
 */
const matchTransactions = async (runId, config) => {
  const { timestampToleranceSeconds, quantityTolerancePct } = config;

  // ── Load transactions ────────────────────────────────────────────────────
  const [userTxns, exchangeTxns] = await Promise.all([
    Transaction.find({ reconciliationRunId: runId, source: "USER" }).lean(),
    Transaction.find({ reconciliationRunId: runId, source: "EXCHANGE" }).lean(),
  ]);

  logger.info(
    `[Matching] Loaded ${userTxns.length} USER and ${exchangeTxns.length} EXCHANGE transactions for run ${runId}`
  );

  // Track which exchange transactions have been claimed
  const matchedExchangeIds = new Set();

  const matchedResults = [];
  const conflictingResults = [];

  // Separate user transactions that can't be matched (blocking issues)
  const matchableUserTxns = [];
  const unmatchableUserTxns = [];

  for (const ut of userTxns) {
    if (ut.hasBlockingIssues) {
      unmatchableUserTxns.push(ut);
    } else {
      matchableUserTxns.push(ut);
    }
  }

  // Separate matchable exchange transactions
  const matchableExchangeTxns = exchangeTxns.filter((et) => !et.hasBlockingIssues);
  const unmatchableExchangeTxns = exchangeTxns.filter((et) => et.hasBlockingIssues);

  logger.info(
    `[Matching] Matchable: ${matchableUserTxns.length} USER, ${matchableExchangeTxns.length} EXCHANGE | ` +
      `Blocked: ${unmatchableUserTxns.length} USER, ${unmatchableExchangeTxns.length} EXCHANGE`
  );

  // ── Phase 1: Exact ID Matching ───────────────────────────────────────────
  logger.info("[Matching] Phase 1: Exact transaction ID matching...");

  // Build index of exchange transactions keyed by transactionId
  const exchangeByTxId = new Map();
  for (const et of matchableExchangeTxns) {
    if (et.transactionId) {
      // Multiple exchange rows could share an ID (edge case) — keep last seen
      if (!exchangeByTxId.has(et.transactionId)) {
        exchangeByTxId.set(et.transactionId, []);
      }
      exchangeByTxId.get(et.transactionId).push(et);
    }
  }

  const remainingUserTxns = [];

  for (const ut of matchableUserTxns) {
    let foundExact = false;

    if (ut.transactionId && exchangeByTxId.has(ut.transactionId)) {
      const candidates = exchangeByTxId.get(ut.transactionId).filter(
        (et) => !matchedExchangeIds.has(String(et._id))
      );

      if (candidates.length > 0) {
        // Take the first unmatched candidate with the same ID
        const et = candidates[0];
        const result = buildMatchResult(ut, et, config, "exact_id");

        if (result.isConflicting) {
          conflictingResults.push(result);
          logger.debug(
            `[Matching] CONFLICT (exact ID): USER ${ut.transactionId} ↔ EXCHANGE ${et.transactionId} — ${result.conflictReasons.join(", ")}`
          );
        } else {
          matchedResults.push(result);
          logger.debug(
            `[Matching] MATCHED (exact ID): ${ut.transactionId}`
          );
        }

        matchedExchangeIds.add(String(et._id));
        foundExact = true;
      }
    }

    if (!foundExact) {
      remainingUserTxns.push(ut);
    }
  }

  logger.info(
    `[Matching] Phase 1 complete: ${matchedResults.length} matched, ${conflictingResults.length} conflicting, ${remainingUserTxns.length} remaining`
  );

  // ── Phase 2: Fuzzy Matching ──────────────────────────────────────────────
  logger.info("[Matching] Phase 2: Fuzzy matching (asset + type + time + qty)...");

  // Build index of unmatched exchange transactions by (normalizedAsset, normalizedType)
  const exchangeByAssetType = buildAssetTypeIndex(
    matchableExchangeTxns.filter((et) => !matchedExchangeIds.has(String(et._id)))
  );

  const unmatchedUserTxns = [...unmatchableUserTxns];

  for (const ut of remainingUserTxns) {
    const key = makeAssetTypeKey(ut.normalizedAsset, ut.normalizedType);
    const candidates = (exchangeByAssetType.get(key) || []).filter(
      (et) => !matchedExchangeIds.has(String(et._id))
    );

    if (candidates.length === 0) {
      unmatchedUserTxns.push(ut);
      continue;
    }

    // Score each candidate; pick lowest score within tolerance
    let bestCandidate = null;
    let bestScore = Infinity;
    let bestResult = null;

    for (const et of candidates) {
      const result = buildMatchResult(ut, et, config, "fuzzy");
      const score = computeMatchScore({
        timestampDiffSeconds: result.timestampDiffSeconds,
        quantityDiffPct: result.quantityDiffPct,
        timestampToleranceSeconds,
        quantityTolerancePct,
      });

      // Only consider candidates where BOTH tolerances pass OR it's a conflict
      // (we still report conflicts for best-scoring candidate)
      if (score < bestScore) {
        bestScore = score;
        bestCandidate = et;
        bestResult = result;
      }
    }

    if (!bestCandidate) {
      unmatchedUserTxns.push(ut);
      continue;
    }

    // Decide: does it truly match or is it a conflict?
    if (bestResult.isConflicting) {
      conflictingResults.push(bestResult);
      logger.debug(
        `[Matching] CONFLICT (fuzzy): USER ${ut._id} ↔ EXCHANGE ${bestCandidate._id} — ${bestResult.conflictReasons.join(", ")}`
      );
    } else {
      matchedResults.push(bestResult);
      logger.debug(
        `[Matching] MATCHED (fuzzy): USER ${ut._id} ↔ EXCHANGE ${bestCandidate._id} (score: ${bestScore.toFixed(4)})`
      );
    }

    matchedExchangeIds.add(String(bestCandidate._id));
  }

  // ── Collect unmatched exchange transactions ───────────────────────────────
  const unmatchedExchangeTxns = [
    ...unmatchableExchangeTxns,
    ...matchableExchangeTxns.filter((et) => !matchedExchangeIds.has(String(et._id))),
  ];

  logger.info(
    `[Matching] Phase 2 complete: ` +
      `${matchedResults.length} matched, ${conflictingResults.length} conflicting, ` +
      `${unmatchedUserTxns.length} unmatched (user), ${unmatchedExchangeTxns.length} unmatched (exchange)`
  );

  // ── Persist reconciliation status back to DB ─────────────────────────────
  await persistMatchingResults({
    matchedResults,
    conflictingResults,
    unmatchedUserTxns,
    unmatchedExchangeTxns,
  });

  return {
    matched: matchedResults,
    conflicting: conflictingResults,
    unmatchedUser: unmatchedUserTxns,
    unmatchedExchange: unmatchedExchangeTxns,
  };
};

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a canonical key for the asset+type index.
 */
const makeAssetTypeKey = (asset, type) =>
  `${(asset || "UNKNOWN").toUpperCase()}::${(type || "UNKNOWN").toUpperCase()}`;

/**
 * Build a Map from (asset, type) key → array of exchange transactions.
 */
const buildAssetTypeIndex = (txns) => {
  const map = new Map();
  for (const et of txns) {
    const key = makeAssetTypeKey(et.normalizedAsset, et.normalizedType);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(et);
  }
  return map;
};

/**
 * Given a user and exchange transaction, compute all match metrics and
 * determine if they are a clean match or a conflict.
 *
 * @param {object} ut - User transaction (lean)
 * @param {object} et - Exchange transaction (lean)
 * @param {object} config - { timestampToleranceSeconds, quantityTolerancePct }
 * @param {"exact_id"|"fuzzy"} matchMethod
 * @returns {MatchResult}
 */
const buildMatchResult = (ut, et, config, matchMethod) => {
  const { timestampToleranceSeconds, quantityTolerancePct } = config;

  const timestampDiffSeconds = getTimestampDiffSeconds(ut.timestamp, et.timestamp);
  const quantityDiffPct = getQuantityDiffPct(ut.quantity, et.quantity);

  const tsOk = isTimestampWithinTolerance(ut.timestamp, et.timestamp, timestampToleranceSeconds);
  const qtyOk = isQuantityWithinTolerance(ut.quantity, et.quantity, quantityTolerancePct);

  const conflictReasons = [];
  if (!tsOk) {
    conflictReasons.push(
      `timestamp diff ${timestampDiffSeconds.toFixed(0)}s exceeds tolerance ${timestampToleranceSeconds}s`
    );
  }
  if (!qtyOk) {
    conflictReasons.push(
      `quantity diff ${(quantityDiffPct * 100).toFixed(4)}% exceeds tolerance ${(quantityTolerancePct * 100).toFixed(4)}%`
    );
  }

  return {
    userTransaction: ut,
    exchangeTransaction: et,
    matchMethod,
    timestampDiffSeconds,
    quantityDiffPct,
    isConflicting: conflictReasons.length > 0,
    conflictReasons,
  };
};

/**
 * Persist reconciliation statuses to the Transaction collection.
 */
const persistMatchingResults = async ({
  matchedResults,
  conflictingResults,
  unmatchedUserTxns,
  unmatchedExchangeTxns,
}) => {
  const bulkOps = [];

  for (const r of matchedResults) {
    bulkOps.push({
      updateOne: {
        filter: { _id: r.userTransaction._id },
        update: {
          $set: {
            reconciliationStatus: "MATCHED",
            matchedTransactionId: r.exchangeTransaction._id,
          },
        },
      },
    });
    bulkOps.push({
      updateOne: {
        filter: { _id: r.exchangeTransaction._id },
        update: {
          $set: {
            reconciliationStatus: "MATCHED",
            matchedTransactionId: r.userTransaction._id,
          },
        },
      },
    });
  }

  for (const r of conflictingResults) {
    bulkOps.push({
      updateOne: {
        filter: { _id: r.userTransaction._id },
        update: {
          $set: {
            reconciliationStatus: "CONFLICTING",
            matchedTransactionId: r.exchangeTransaction._id,
          },
        },
      },
    });
    bulkOps.push({
      updateOne: {
        filter: { _id: r.exchangeTransaction._id },
        update: {
          $set: {
            reconciliationStatus: "CONFLICTING",
            matchedTransactionId: r.userTransaction._id,
          },
        },
      },
    });
  }

  for (const t of unmatchedUserTxns) {
    bulkOps.push({
      updateOne: {
        filter: { _id: t._id },
        update: { $set: { reconciliationStatus: "UNMATCHED" } },
      },
    });
  }

  for (const t of unmatchedExchangeTxns) {
    bulkOps.push({
      updateOne: {
        filter: { _id: t._id },
        update: { $set: { reconciliationStatus: "UNMATCHED" } },
      },
    });
  }

  if (bulkOps.length > 0) {
    await Transaction.bulkWrite(bulkOps, { ordered: false });
    logger.info(`[Matching] Persisted ${bulkOps.length} status updates to DB`);
  }
};

module.exports = { matchTransactions };
