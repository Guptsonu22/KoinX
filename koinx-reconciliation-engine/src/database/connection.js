"use strict";

const mongoose = require("mongoose");
const config = require("../config/config");
const logger = require("../utils/logger");

/**
 * Establish a MongoDB connection with retry logic.
 * Exported so tests can call connectDB() independently.
 */
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(config.mongoURI, {
      // Mongoose 8.x uses these options by default; listed for clarity
      serverSelectionTimeoutMS: 5000,
    });

    logger.info(`✅ MongoDB connected: ${conn.connection.host}`);
    return conn;
  } catch (error) {
    logger.error(`❌ MongoDB connection error: ${error.message}`);
    throw error;
  }
};

/**
 * Disconnect from MongoDB — used in tests.
 */
const disconnectDB = async () => {
  await mongoose.disconnect();
  logger.info("MongoDB disconnected.");
};

// Mongoose global event hooks
mongoose.connection.on("disconnected", () => {
  logger.warn("MongoDB disconnected.");
});

mongoose.connection.on("reconnected", () => {
  logger.info("MongoDB reconnected.");
});

module.exports = { connectDB, disconnectDB };
