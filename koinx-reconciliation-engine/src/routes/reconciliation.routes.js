"use strict";

const express = require("express");
const router = express.Router();

const {
  triggerReconciliation,
  getReport,
  getReportSummary,
  getReportUnmatched,
} = require("../controllers/reconciliation.controller");

const { uploadFiles } = require("../middleware/upload.middleware");

/**
 * POST /reconcile
 * Trigger a new reconciliation run.
 * Accepts: multipart/form-data with fields 'userFile' and 'exchangeFile'
 * Optional body fields: timestampToleranceSeconds, quantityTolerancePct
 */
router.post("/reconcile", uploadFiles, triggerReconciliation);

/**
 * GET /report/:runId
 * Fetch the full reconciliation report.
 * Query: ?page=1&limit=100
 */
router.get("/report/:runId", getReport);

/**
 * GET /report/:runId/summary
 * Fetch just the counts summary for a run.
 */
router.get("/report/:runId/summary", getReportSummary);

/**
 * GET /report/:runId/unmatched
 * Fetch only unmatched entries (USER only + EXCHANGE only).
 * Query: ?page=1&limit=100
 */
router.get("/report/:runId/unmatched", getReportUnmatched);

module.exports = router;
