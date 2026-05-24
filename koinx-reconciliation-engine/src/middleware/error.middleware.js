"use strict";

const logger = require("../utils/logger");

/**
 * Global error handler middleware.
 * Must have 4 parameters (err, req, res, next) for Express to recognize it.
 */
const errorHandler = (err, req, res, _next) => {
  // Log the full error
  logger.error(`[ErrorHandler] ${req.method} ${req.path} — ${err.message}`, {
    stack: err.stack,
  });

  // Handle Multer errors specifically
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({
      success: false,
      error: `File too large. Maximum allowed size is ${process.env.MAX_FILE_SIZE_MB || 50}MB.`,
    });
  }

  if (err.code === "LIMIT_UNEXPECTED_FILE") {
    return res.status(400).json({
      success: false,
      error: "Unexpected file field. Expected 'userFile' and 'exchangeFile'.",
    });
  }

  // Handle Mongoose validation errors
  if (err.name === "ValidationError") {
    const messages = Object.values(err.errors).map((e) => e.message);
    return res.status(400).json({
      success: false,
      error: "Validation error",
      details: messages,
    });
  }

  // Handle Mongoose duplicate key errors
  if (err.code === 11000) {
    return res.status(409).json({
      success: false,
      error: "Duplicate key error",
      details: err.keyValue,
    });
  }

  // Handle file-not-found / custom errors with a status code
  if (err.statusCode) {
    return res.status(err.statusCode).json({
      success: false,
      error: err.message,
    });
  }

  // Default 500
  return res.status(500).json({
    success: false,
    error:
      process.env.NODE_ENV === "production"
        ? "An internal server error occurred."
        : err.message,
  });
};

/**
 * 404 handler for unrecognized routes.
 */
const notFoundHandler = (req, res) => {
  res.status(404).json({
    success: false,
    error: `Route not found: ${req.method} ${req.path}`,
  });
};

module.exports = { errorHandler, notFoundHandler };
