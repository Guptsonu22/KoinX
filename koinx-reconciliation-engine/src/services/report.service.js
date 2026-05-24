"use strict";

const fs = require("fs");
const path = require("path");
const { format: csvFormat } = require("fast-csv");

const ReportEntry = require("../models/ReportEntry");
const ReconciliationRun = require("../models/ReconciliationRun");
const logger = require("../utils/logger");

/**
 * Build ReportEntry documents from matching results and persist to DB.
 * Also generates a CSV report file.
 *
 * @param {string} runId
 * @param {object} matchingResults - { matched, conflicting, unmatchedUser, unmatchedExchange }
 * @returns {Promise<string>} Path to generated CSV report file
 */
const buildAndPersistReport = async (runId, matchingResults) => {
  const { matched, conflicting, unmatchedUser, unmatchedExchange } = matchingResults;

  const entries = [];

  // ── MATCHED entries ────────────────────────────────────────────────────
  for (const r of matched) {
    entries.push({
      runId,
      category: "MATCHED",
      reason: `Transaction matched via ${r.matchMethod === "exact_id" ? "exact transaction ID" : "fuzzy matching"} within tolerance`,
      userTransaction: serializeTransaction(r.userTransaction),
      exchangeTransaction: serializeTransaction(r.exchangeTransaction),
      differences: {
        timestampDiffSeconds: r.timestampDiffSeconds,
        quantityDiffPct: r.quantityDiffPct,
      },
    });
  }

  // ── CONFLICTING entries ────────────────────────────────────────────────
  for (const r of conflicting) {
    entries.push({
      runId,
      category: "CONFLICTING",
      reason: `Pair found but exceeds tolerance: ${r.conflictReasons.join("; ")}`,
      userTransaction: serializeTransaction(r.userTransaction),
      exchangeTransaction: serializeTransaction(r.exchangeTransaction),
      differences: {
        timestampDiffSeconds: r.timestampDiffSeconds,
        quantityDiffPct: r.quantityDiffPct,
      },
    });
  }

  // ── UNMATCHED_USER entries ─────────────────────────────────────────────
  for (const t of unmatchedUser) {
    const reasonParts = [];
    if (t.hasBlockingIssues) {
      reasonParts.push(`blocking data issues: [${t.ingestionIssues.join(", ")}]`);
    } else {
      reasonParts.push("no matching exchange transaction found within tolerance");
    }

    entries.push({
      runId,
      category: "UNMATCHED_USER",
      reason: reasonParts.join("; "),
      userTransaction: serializeTransaction(t),
      exchangeTransaction: null,
      differences: { timestampDiffSeconds: null, quantityDiffPct: null },
    });
  }

  // ── UNMATCHED_EXCHANGE entries ─────────────────────────────────────────
  for (const t of unmatchedExchange) {
    const reasonParts = [];
    if (t.hasBlockingIssues) {
      reasonParts.push(`blocking data issues: [${t.ingestionIssues.join(", ")}]`);
    } else {
      reasonParts.push("no matching user transaction found within tolerance");
    }

    entries.push({
      runId,
      category: "UNMATCHED_EXCHANGE",
      reason: reasonParts.join("; "),
      userTransaction: null,
      exchangeTransaction: serializeTransaction(t),
      differences: { timestampDiffSeconds: null, quantityDiffPct: null },
    });
  }

  // ── Persist to DB ──────────────────────────────────────────────────────
  if (entries.length > 0) {
    await ReportEntry.insertMany(entries, { ordered: false });
    logger.info(`[Report] Inserted ${entries.length} report entries for run ${runId}`);
  }

  // ── Generate CSV report ────────────────────────────────────────────────
  const reportPath = await generateCSVReport(runId, entries);

  return reportPath;
};

/**
 * Generate a CSV report file for a reconciliation run.
 *
 * @param {string} runId
 * @param {object[]} entries - Array of report entry objects
 * @returns {Promise<string>} Absolute path to the generated file
 */
const generateCSVReport = (runId, entries) => {
  return new Promise((resolve, reject) => {
    // Ensure reports directory exists
    const reportsDir = path.join(__dirname, "..", "..", "reports");
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    const reportPath = path.join(reportsDir, `${runId}.csv`);
    const writeStream = fs.createWriteStream(reportPath);

    const csvStream = csvFormat({ headers: true });
    csvStream.pipe(writeStream);

    csvStream.on("error", reject);
    writeStream.on("error", reject);
    writeStream.on("finish", () => {
      logger.info(`[Report] CSV report written to: ${reportPath}`);
      resolve(reportPath);
    });

    for (const entry of entries) {
      const ut = entry.userTransaction || {};
      const et = entry.exchangeTransaction || {};

      csvStream.write({
        category: entry.category,
        reason: entry.reason,

        // User side
        user_transaction_id: ut.transactionId || "",
        user_asset: ut.asset || "",
        user_normalized_asset: ut.normalizedAsset || "",
        user_type: ut.type || "",
        user_normalized_type: ut.normalizedType || "",
        user_quantity: ut.quantity !== null && ut.quantity !== undefined ? ut.quantity : "",
        user_timestamp: ut.timestamp ? new Date(ut.timestamp).toISOString() : "",
        user_ingestion_issues: Array.isArray(ut.ingestionIssues)
          ? ut.ingestionIssues.join("|")
          : "",

        // Exchange side
        exchange_transaction_id: et.transactionId || "",
        exchange_asset: et.asset || "",
        exchange_normalized_asset: et.normalizedAsset || "",
        exchange_type: et.type || "",
        exchange_normalized_type: et.normalizedType || "",
        exchange_quantity:
          et.quantity !== null && et.quantity !== undefined ? et.quantity : "",
        exchange_timestamp: et.timestamp ? new Date(et.timestamp).toISOString() : "",
        exchange_ingestion_issues: Array.isArray(et.ingestionIssues)
          ? et.ingestionIssues.join("|")
          : "",

        // Differences
        timestamp_diff_seconds:
          entry.differences.timestampDiffSeconds !== null
            ? entry.differences.timestampDiffSeconds.toFixed(2)
            : "",
        quantity_diff_pct:
          entry.differences.quantityDiffPct !== null
            ? (entry.differences.quantityDiffPct * 100).toFixed(6)
            : "",
      });
    }

    csvStream.end();
  });
};

/**
 * Fetch full report entries for a run (paginated).
 *
 * @param {string} runId
 * @param {object} options - { page, limit }
 * @returns {Promise<{ entries: ReportEntry[], total: number, page: number, totalPages: number }>}
 */
const getFullReport = async (runId, options = {}) => {
  const page = Math.max(1, Number(options.page) || 1);
  const limit = Math.min(500, Math.max(1, Number(options.limit) || 100));
  const skip = (page - 1) * limit;

  const [entries, total] = await Promise.all([
    ReportEntry.find({ runId }).skip(skip).limit(limit).lean(),
    ReportEntry.countDocuments({ runId }),
  ]);

  return {
    entries,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
};

/**
 * Fetch only summary counts for a run.
 */
const getSummary = async (runId) => {
  const run = await ReconciliationRun.findOne({ runId }).lean();
  if (!run) return null;
  return {
    runId: run.runId,
    status: run.status,
    config: run.config,
    summary: run.summary,
    reportPath: run.reportPath,
    createdAt: run.createdAt,
  };
};

/**
 * Fetch only unmatched entries for a run (paginated).
 */
const getUnmatched = async (runId, options = {}) => {
  const page = Math.max(1, Number(options.page) || 1);
  const limit = Math.min(500, Math.max(1, Number(options.limit) || 100));
  const skip = (page - 1) * limit;

  const filter = {
    runId,
    category: { $in: ["UNMATCHED_USER", "UNMATCHED_EXCHANGE"] },
  };

  const [entries, total] = await Promise.all([
    ReportEntry.find(filter).skip(skip).limit(limit).lean(),
    ReportEntry.countDocuments(filter),
  ]);

  return {
    entries,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Serialize a lean Transaction document into a plain object for the report.
 */
const serializeTransaction = (t) => {
  if (!t) return null;
  return {
    _id: String(t._id),
    transactionId: t.transactionId,
    asset: t.asset,
    normalizedAsset: t.normalizedAsset,
    type: t.type,
    normalizedType: t.normalizedType,
    quantity: t.quantity,
    timestamp: t.timestamp,
    ingestionIssues: t.ingestionIssues || [],
    hasBlockingIssues: t.hasBlockingIssues,
    rawRow: t.rawRow,
  };
};

module.exports = {
  buildAndPersistReport,
  generateCSVReport,
  getFullReport,
  getSummary,
  getUnmatched,
};
