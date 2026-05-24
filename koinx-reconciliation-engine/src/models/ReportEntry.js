"use strict";

const mongoose = require("mongoose");

/**
 * ReportEntry stores one reconciliation result row.
 * Having this as a separate collection (instead of only a CSV) allows
 * the API endpoints to query efficiently by category, runId, etc.
 */
const reportEntrySchema = new mongoose.Schema(
  {
    runId: {
      type: String,
      required: true,
      index: true,
    },

    // Result category
    category: {
      type: String,
      enum: ["MATCHED", "CONFLICTING", "UNMATCHED_USER", "UNMATCHED_EXCHANGE"],
      required: true,
      index: true,
    },

    // Human-readable explanation of why this category was assigned
    reason: {
      type: String,
      required: true,
    },

    // Snapshot of the user-side transaction (null for UNMATCHED_EXCHANGE)
    userTransaction: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    // Snapshot of the exchange-side transaction (null for UNMATCHED_USER)
    exchangeTransaction: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    // Quantified differences (populated for MATCHED and CONFLICTING)
    differences: {
      timestampDiffSeconds: { type: Number, default: null },
      quantityDiffPct: { type: Number, default: null },
    },
  },
  {
    timestamps: true,
  }
);

// Index for efficient category filtering
reportEntrySchema.index({ runId: 1, category: 1 });

const ReportEntry = mongoose.model("ReportEntry", reportEntrySchema);

module.exports = ReportEntry;
