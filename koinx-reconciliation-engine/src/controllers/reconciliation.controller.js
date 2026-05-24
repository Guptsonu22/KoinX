"use strict";

const path = require("path");
const fs = require("fs");

const { runReconciliation } = require("../services/reconciliation.service");
const {
  getFullReport,
  getSummary,
  getUnmatched,
} = require("../services/report.service");
const ReconciliationRun = require("../models/ReconciliationRun");
const logger = require("../utils/logger");

/**
 * POST /reconcile
 *
 * Triggers a new reconciliation run.
 * Accepts two CSV files (userFile + exchangeFile) via multipart/form-data.
 * Optionally accepts tolerance overrides in the request body.
 */
const triggerReconciliation = async (req, res, next) => {
  try {
    const files = req.files;

    if (!files || !files.userFile || !files.exchangeFile) {
      return res.status(400).json({
        success: false,
        error: "Both 'userFile' and 'exchangeFile' CSV uploads are required.",
      });
    }

    const userFile = files.userFile[0];
    const exchangeFile = files.exchangeFile[0];

    // Parse optional tolerance overrides from body
    const toleranceOverrides = {};

    if (req.body.timestampToleranceSeconds !== undefined) {
      const val = Number(req.body.timestampToleranceSeconds);
      if (isNaN(val) || val < 0) {
        return res.status(400).json({
          success: false,
          error: "timestampToleranceSeconds must be a non-negative number.",
        });
      }
      toleranceOverrides.timestampToleranceSeconds = val;
    }

    if (req.body.quantityTolerancePct !== undefined) {
      const val = Number(req.body.quantityTolerancePct);
      if (isNaN(val) || val < 0 || val > 1) {
        return res.status(400).json({
          success: false,
          error: "quantityTolerancePct must be a number between 0 and 1 (e.g., 0.01 for 1%).",
        });
      }
      toleranceOverrides.quantityTolerancePct = val;
    }

    logger.info(
      `[Controller] POST /reconcile — user: ${userFile.originalname}, exchange: ${exchangeFile.originalname}`
    );

    const { runId, summary } = await runReconciliation({
      userFilePath: userFile.path,
      exchangeFilePath: exchangeFile.path,
      userFileName: userFile.originalname,
      exchangeFileName: exchangeFile.originalname,
      toleranceOverrides,
    });

    // Clean up uploaded temp files
    cleanupFile(userFile.path);
    cleanupFile(exchangeFile.path);

    return res.status(200).json({
      success: true,
      runId,
      summary,
      links: {
        report: `/report/${runId}`,
        summary: `/report/${runId}/summary`,
        unmatched: `/report/${runId}/unmatched`,
        csv: `/reports/${runId}.csv`,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /report/:runId
 *
 * Returns the full reconciliation report (paginated).
 * Query params: page (default 1), limit (default 100, max 500)
 */
const getReport = async (req, res, next) => {
  try {
    const { runId } = req.params;

    // Verify run exists
    const run = await ReconciliationRun.findOne({ runId }).lean();
    if (!run) {
      return res.status(404).json({
        success: false,
        error: `Run '${runId}' not found.`,
      });
    }

    const { page, limit } = req.query;
    const result = await getFullReport(runId, { page, limit });

    return res.status(200).json({
      success: true,
      runId,
      status: run.status,
      ...result,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /report/:runId/summary
 *
 * Returns just the counts: matched, conflicting, unmatchedUser, unmatchedExchange.
 */
const getReportSummary = async (req, res, next) => {
  try {
    const { runId } = req.params;

    const summary = await getSummary(runId);
    if (!summary) {
      return res.status(404).json({
        success: false,
        error: `Run '${runId}' not found.`,
      });
    }

    return res.status(200).json({
      success: true,
      ...summary,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /report/:runId/unmatched
 *
 * Returns only unmatched entries (UNMATCHED_USER + UNMATCHED_EXCHANGE), paginated.
 * Query params: page, limit
 */
const getReportUnmatched = async (req, res, next) => {
  try {
    const { runId } = req.params;

    // Verify run exists
    const run = await ReconciliationRun.findOne({ runId }).lean();
    if (!run) {
      return res.status(404).json({
        success: false,
        error: `Run '${runId}' not found.`,
      });
    }

    const { page, limit } = req.query;
    const result = await getUnmatched(runId, { page, limit });

    return res.status(200).json({
      success: true,
      runId,
      status: run.status,
      ...result,
    });
  } catch (error) {
    next(error);
  }
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const cleanupFile = (filePath) => {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // Non-critical — log and continue
    logger.warn(`[Controller] Could not delete temp file: ${filePath}`);
  }
};

module.exports = {
  triggerReconciliation,
  getReport,
  getReportSummary,
  getReportUnmatched,
};
