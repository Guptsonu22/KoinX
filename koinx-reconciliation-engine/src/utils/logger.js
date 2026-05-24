"use strict";

const path = require("path");
const { createLogger, format, transports } = require("winston");
const config = require("../config/config");

// Ensure logs directory exists (Winston will create the file, but not the dir)
const fs = require("fs");
const logsDir = path.join(__dirname, "..", "..", "logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const { combine, timestamp, printf, colorize, errors } = format;

// Custom log format for file output
const fileFormat = combine(
  errors({ stack: true }),
  timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  printf(({ level, message, timestamp, stack }) => {
    return stack
      ? `[${timestamp}] ${level.toUpperCase()}: ${message}\n${stack}`
      : `[${timestamp}] ${level.toUpperCase()}: ${message}`;
  })
);

// Custom log format for console output (with colors)
const consoleFormat = combine(
  colorize({ all: true }),
  errors({ stack: true }),
  timestamp({ format: "HH:mm:ss" }),
  printf(({ level, message, timestamp, stack }) => {
    return stack
      ? `[${timestamp}] ${level}: ${message}\n${stack}`
      : `[${timestamp}] ${level}: ${message}`;
  })
);

const logger = createLogger({
  level: config.logLevel || "info",
  transports: [
    // Console transport (human-readable)
    new transports.Console({
      format: consoleFormat,
    }),
    // File transport — all levels
    new transports.File({
      filename: path.join(logsDir, "app.log"),
      format: fileFormat,
      maxsize: 10 * 1024 * 1024, // 10 MB
      maxFiles: 5,
    }),
    // Separate error log file
    new transports.File({
      filename: path.join(logsDir, "error.log"),
      level: "error",
      format: fileFormat,
      maxsize: 10 * 1024 * 1024,
      maxFiles: 3,
    }),
  ],
});

// Add http level for Morgan integration
logger.http = (message) => logger.verbose(message);

module.exports = logger;
