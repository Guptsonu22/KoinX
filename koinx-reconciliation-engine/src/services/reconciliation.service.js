"use strict";

const { v4: uuidv4 } = require("uuid");

const ReconciliationRun = require("../models/ReconciliationRun");
const { parseAndIngestCSV } = require("./csv.service");
const { matchTransactions } = require("./matching.service");
const { buildAndPersistReport } = require("./report.service");
const config = require("../config/config");
const logger = require("../utils/logger");

/**
 * Orchestrates the full reconciliation pipeline:
 *   1. Create ReconciliationRun record
 *   2. Parse & ingest both CSV files
 *   3. Run matching engine
 *   4. Build & persist reconciliation report
 *   5. Update run with summary and mark COMPLETED
 *
 * @param {object} params
 * @param {string} params.userFilePath       - Absolute path to user CSV
 * @param {string} params.exchangeFilePath   - Absolute path to exchange CSV
 * @param {string} params.userFileName       - Original filename (for audit)
 * @param {string} params.exchangeFileName   - Original filename (for audit)
 * @param {object} [params.toleranceOverrides] - Optional { timestampToleranceSeconds, quantityTolerancePct }
 *
 * @returns {Promise<{ runId: string, summary: object }>}
 */
const runReconciliation = async ({
  userFilePath,
  exchangeFilePath,
  userFileName,
  exchangeFileName,
  toleranceOverrides = {},
}) => {
  const runId = `run_${uuidv4()}`;

  // ── Effective config (env defaults + per-request overrides) ────────────
  const effectiveConfig = {
    timestampToleranceSeconds:
      toleranceOverrides.timestampToleranceSeconds !== undefined
        ? Number(toleranceOverrides.timestampToleranceSeconds)
        : config.timestampToleranceSeconds,

    quantityTolerancePct:
      toleranceOverrides.quantityTolerancePct !== undefined
        ? Number(toleranceOverrides.quantityTolerancePct)
        : config.quantityTolerancePct,
  };

  logger.info(`[Reconciliation] Starting run ${runId}`);
  logger.info(
    `[Reconciliation] Config: timestampTolerance=${effectiveConfig.timestampToleranceSeconds}s, ` +
      `quantityTolerance=${effectiveConfig.quantityTolerancePct * 100}%`
  );

  // ── Create run record ──────────────────────────────────────────────────
  const run = await ReconciliationRun.create({
    runId,
    config: effectiveConfig,
    status: "RUNNING",
    userFileName,
    exchangeFileName,
  });

  try {
    // ── Step 1: Parse & Ingest CSVs ──────────────────────────────────────
    logger.info("[Reconciliation] Step 1: Parsing and ingesting CSVs...");

    const [userResult, exchangeResult] = await Promise.all([
      parseAndIngestCSV(userFilePath, "USER", runId),
      parseAndIngestCSV(exchangeFilePath, "EXCHANGE", runId),
    ]);

    logger.info(
      `[Reconciliation] Ingested: ${userResult.total} USER rows (${userResult.rowsWithIssues} with issues), ` +
        `${exchangeResult.total} EXCHANGE rows (${exchangeResult.rowsWithIssues} with issues)`
    );

    // ── Step 2: Run Matching Engine ──────────────────────────────────────
    logger.info("[Reconciliation] Step 2: Running matching engine...");

    const matchingResults = await matchTransactions(runId, effectiveConfig);

    // ── Step 3: Build & Persist Report ──────────────────────────────────
    logger.info("[Reconciliation] Step 3: Building reconciliation report...");

    const reportPath = await buildAndPersistReport(runId, matchingResults);

    // ── Step 4: Update run summary ───────────────────────────────────────
    const summary = {
      matched: matchingResults.matched.length,
      conflicting: matchingResults.conflicting.length,
      unmatchedUser: matchingResults.unmatchedUser.length,
      unmatchedExchange: matchingResults.unmatchedExchange.length,
      totalUser: userResult.total,
      totalExchange: exchangeResult.total,
      userRowsWithIssues: userResult.rowsWithIssues,
      exchangeRowsWithIssues: exchangeResult.rowsWithIssues,
    };

    await ReconciliationRun.updateOne(
      { runId },
      {
        $set: {
          status: "COMPLETED",
          summary,
          reportPath,
        },
      }
    );

    logger.info(
      `[Reconciliation] Run ${runId} COMPLETED. ` +
        `Matched: ${summary.matched}, Conflicting: ${summary.conflicting}, ` +
        `UnmatchedUser: ${summary.unmatchedUser}, UnmatchedExchange: ${summary.unmatchedExchange}`
    );

    return { runId, summary };
  } catch (error) {
    // Mark run as FAILED with error message
    await ReconciliationRun.updateOne(
      { runId },
      { $set: { status: "FAILED", errorMessage: error.message } }
    ).catch(() => {}); // best effort

    logger.error(`[Reconciliation] Run ${runId} FAILED: ${error.message}`);
    throw error;
  }
};

module.exports = { runReconciliation };
