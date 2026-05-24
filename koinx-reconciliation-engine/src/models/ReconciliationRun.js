"use strict";

const mongoose = require("mongoose");

const reconciliationRunSchema = new mongoose.Schema(
  {
    runId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    // Effective configuration used for this run
    config: {
      timestampToleranceSeconds: {
        type: Number,
        required: true,
      },
      quantityTolerancePct: {
        type: Number,
        required: true,
      },
    },

    // Summary counts (populated after matching completes)
    summary: {
      matched: { type: Number, default: 0 },
      conflicting: { type: Number, default: 0 },
      unmatchedUser: { type: Number, default: 0 },
      unmatchedExchange: { type: Number, default: 0 },
      totalUser: { type: Number, default: 0 },
      totalExchange: { type: Number, default: 0 },
      userRowsWithIssues: { type: Number, default: 0 },
      exchangeRowsWithIssues: { type: Number, default: 0 },
    },

    // Path to the generated CSV report file
    reportPath: {
      type: String,
      default: null,
    },

    // Run lifecycle status
    status: {
      type: String,
      enum: ["PENDING", "RUNNING", "COMPLETED", "FAILED"],
      default: "PENDING",
    },

    // Error message if status === FAILED
    errorMessage: {
      type: String,
      default: null,
    },

    // Original filenames for auditing
    userFileName: { type: String, default: null },
    exchangeFileName: { type: String, default: null },
  },
  {
    timestamps: true,
  }
);

const ReconciliationRun = mongoose.model("ReconciliationRun", reconciliationRunSchema);

module.exports = ReconciliationRun;
