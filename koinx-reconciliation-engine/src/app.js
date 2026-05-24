"use strict";

const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const path = require("path");

const reconciliationRoutes = require("./routes/reconciliation.routes");
const { errorHandler, notFoundHandler } = require("./middleware/error.middleware");
const logger = require("./utils/logger");

const app = express();

// ── Core Middleware ─────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// HTTP request logging via Morgan → piped through Winston
app.use(
  morgan("combined", {
    stream: { write: (msg) => logger.http(msg.trim()) },
  })
);

// ── Static Directories ──────────────────────────────────────────────────────
// Allow direct download of generated reports
app.use("/reports", express.static(path.join(__dirname, "..", "reports")));

// ── Health Check ────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "KoinX Reconciliation Engine",
    timestamp: new Date().toISOString(),
  });
});

// ── API Routes ──────────────────────────────────────────────────────────────
app.use("/", reconciliationRoutes);

// ── 404 & Error Handlers ────────────────────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
