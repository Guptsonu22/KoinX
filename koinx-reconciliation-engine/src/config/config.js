"use strict";

require("dotenv").config();

const config = {
  port: Number(process.env.PORT) || 5000,
  nodeEnv: process.env.NODE_ENV || "development",

  // Database
  mongoURI: process.env.MONGO_URI || "mongodb://localhost:27017/koinx_reconciliation",

  // Matching tolerances (can be overridden per-request)
  timestampToleranceSeconds: Number(process.env.TIMESTAMP_TOLERANCE_SECONDS) || 300,
  quantityTolerancePct: Number(process.env.QUANTITY_TOLERANCE_PCT) || 0.01,

  // Logging
  logLevel: process.env.LOG_LEVEL || "info",

  // Upload limits
  maxFileSizeMB: Number(process.env.MAX_FILE_SIZE_MB) || 50,
};

module.exports = config;
