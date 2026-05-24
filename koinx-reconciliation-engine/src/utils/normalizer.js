"use strict";

const { resolveAsset } = require("./assetAliases");
const { resolveType } = require("./typeMappings");

/**
 * Normalize a raw CSV row into structured transaction fields.
 *
 * This function handles:
 *  - Field name aliases (e.g., "amount" → quantity, "date" → timestamp)
 *  - Type coercion (string → number, string → Date)
 *  - Asset and type normalization via alias maps
 *  - Data quality flag collection (non-blocking warnings + blocking errors)
 *
 * Returns:
 *  {
 *    fields:  { transactionId, asset, normalizedAsset, type, normalizedType,
 *               quantity, timestamp },
 *    issues:  string[]           // IngestionIssueEnum values
 *    hasBlockingIssues: boolean  // true = row cannot be matched
 *  }
 *
 * @param {object} row - Raw CSV row (all values are strings)
 * @returns {{ fields: object, issues: string[], hasBlockingIssues: boolean }}
 */
const normalizeRow = (row) => {
  const issues = [];
  let hasBlockingIssues = false;

  // ── 1. Transaction ID ────────────────────────────────────────────────────
  // Try common column names (case-insensitive keys)
  const rawId =
    findField(row, ["transaction_id", "transactionid", "txid", "id", "tx_id", "txhash"]) ?? null;

  const transactionId = rawId ? String(rawId).trim() : null;

  if (!transactionId) {
    // Missing ID is a warning only — we can still fuzzy-match
    issues.push("MISSING_TRANSACTION_ID");
  }

  // ── 2. Asset ─────────────────────────────────────────────────────────────
  const rawAsset =
    findField(row, ["asset", "currency", "coin", "symbol", "crypto"]) ?? null;

  if (!rawAsset || !String(rawAsset).trim()) {
    issues.push("MISSING_ASSET");
    hasBlockingIssues = true;
  }

  const assetStr = rawAsset ? String(rawAsset).trim() : null;
  const { normalized: normalizedAsset, isKnown: isKnownAsset } = assetStr
    ? resolveAsset(assetStr)
    : { normalized: null, isKnown: false };

  if (assetStr && !isKnownAsset) {
    // Unknown asset is a warning (we still store it)
    issues.push("UNKNOWN_ASSET");
  }

  // ── 3. Transaction Type ──────────────────────────────────────────────────
  const rawType =
    findField(row, ["type", "transaction_type", "txtype", "kind", "action"]) ?? null;

  if (!rawType || !String(rawType).trim()) {
    issues.push("MISSING_TYPE");
    hasBlockingIssues = true;
  }

  const typeStr = rawType ? String(rawType).trim() : null;
  const { normalized: normalizedType, isKnown: isKnownType } = typeStr
    ? resolveType(typeStr)
    : { normalized: null, isKnown: false };

  if (typeStr && !isKnownType) {
    issues.push("UNKNOWN_TYPE");
  }

  // ── 4. Quantity ──────────────────────────────────────────────────────────
  const rawQty =
    findField(row, ["quantity", "amount", "qty", "volume", "size"]) ?? null;

  if (rawQty === null || rawQty === undefined || String(rawQty).trim() === "") {
    issues.push("MISSING_QUANTITY");
    hasBlockingIssues = true;
  }

  // Strip commas, currency symbols, extra whitespace
  const qtyStr = rawQty !== null ? String(rawQty).replace(/[,$€£\s]/g, "") : "";
  const quantity = qtyStr !== "" ? Number(qtyStr) : null;

  if (quantity !== null && (isNaN(quantity) || quantity < 0)) {
    issues.push("INVALID_QUANTITY");
    hasBlockingIssues = true;
  }

  // ── 5. Timestamp ─────────────────────────────────────────────────────────
  const rawTs =
    findField(row, [
      "timestamp",
      "date",
      "datetime",
      "time",
      "created_at",
      "transaction_date",
      "tx_time",
    ]) ?? null;

  if (!rawTs || !String(rawTs).trim()) {
    issues.push("MISSING_TIMESTAMP");
    hasBlockingIssues = true;
  }

  let timestamp = null;
  if (rawTs) {
    // Try standard Date.parse; also handle Unix epoch seconds/ms
    const tsStr = String(rawTs).trim();
    const asNum = Number(tsStr);

    if (!isNaN(asNum) && asNum > 0) {
      // Heuristic: values < 10^12 are likely seconds, larger are milliseconds
      timestamp = new Date(asNum < 1e12 ? asNum * 1000 : asNum);
    } else {
      timestamp = new Date(tsStr);
    }

    if (isNaN(timestamp.getTime())) {
      issues.push("INVALID_TIMESTAMP");
      hasBlockingIssues = true;
      timestamp = null;
    }
  }

  return {
    fields: {
      transactionId,
      asset: assetStr,
      normalizedAsset,
      type: typeStr,
      normalizedType,
      quantity: isNaN(quantity) ? null : quantity,
      timestamp,
    },
    issues,
    hasBlockingIssues,
  };
};

/**
 * Case-insensitive field lookup with multiple candidate keys.
 * Returns the first match found, or undefined.
 *
 * @param {object} row
 * @param {string[]} candidates - lowercase field names to try
 * @returns {*}
 */
const findField = (row, candidates) => {
  const rowKeys = Object.keys(row);
  for (const candidate of candidates) {
    const match = rowKeys.find((k) => k.trim().toLowerCase() === candidate);
    if (match !== undefined && row[match] !== undefined) {
      return row[match];
    }
  }
  return undefined;
};

module.exports = { normalizeRow, findField };
