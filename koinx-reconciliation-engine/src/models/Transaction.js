"use strict";

const mongoose = require("mongoose");

const IngestionIssueEnum = [
  "MISSING_TRANSACTION_ID",
  "MISSING_ASSET",
  "MISSING_TYPE",
  "MISSING_QUANTITY",
  "INVALID_QUANTITY",     // NaN, negative
  "MISSING_TIMESTAMP",
  "INVALID_TIMESTAMP",   // un-parseable date
  "UNKNOWN_ASSET",       // asset not in alias map (warn only, not error)
  "UNKNOWN_TYPE",        // type not in type-map (warn only)
];

const ReconciliationStatusEnum = ["PENDING", "MATCHED", "CONFLICTING", "UNMATCHED"];

const transactionSchema = new mongoose.Schema(
  {
    // ── Source identification ───────────────────────────────────────
    source: {
      type: String,
      enum: ["USER", "EXCHANGE"],
      required: true,
      index: true,
    },

    reconciliationRunId: {
      type: String,
      required: true,
      index: true,
    },

    // ── Raw fields (as-parsed) ──────────────────────────────────────
    transactionId: {
      type: String,
      default: null,
    },

    asset: {
      type: String,
      default: null,
    },

    type: {
      type: String,
      default: null,
    },

    quantity: {
      type: Number,
      default: null,
    },

    timestamp: {
      type: Date,
      default: null,
    },

    // ── Normalized fields (used in matching) ────────────────────────
    normalizedAsset: {
      type: String,
      default: null,
      index: true,
    },

    normalizedType: {
      type: String,
      default: null,
      index: true,
    },

    // ── Raw CSV row object (for report output) ──────────────────────
    rawRow: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },

    // ── Data quality flags ──────────────────────────────────────────
    ingestionIssues: {
      type: [String],
      enum: IngestionIssueEnum,
      default: [],
    },

    // Has issues that prevent matching (true = cannot be matched)
    hasBlockingIssues: {
      type: Boolean,
      default: false,
    },

    // ── Reconciliation state ────────────────────────────────────────
    reconciliationStatus: {
      type: String,
      enum: ReconciliationStatusEnum,
      default: "PENDING",
      index: true,
    },

    // Reference to the matched transaction on the other side
    matchedTransactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Transaction",
      default: null,
    },
  },
  {
    timestamps: true,
    // Optimize reads by compound index on common query patterns
  }
);

// Compound indexes for matching lookups
transactionSchema.index({ reconciliationRunId: 1, source: 1, normalizedAsset: 1 });
transactionSchema.index({ reconciliationRunId: 1, transactionId: 1 });

const Transaction = mongoose.model("Transaction", transactionSchema);

module.exports = Transaction;
