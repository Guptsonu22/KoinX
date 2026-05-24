"use strict";

const path = require("path");
const fs = require("fs");
const multer = require("multer");
const config = require("../config/config");

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, "..", "..", "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

/**
 * Multer storage — disk storage with descriptive filenames.
 */
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (_req, file, cb) => {
    // Prefix with timestamp + fieldname to avoid collisions
    const ts = Date.now();
    const safeOriginal = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${ts}_${file.fieldname}_${safeOriginal}`);
  },
});

/**
 * File filter — accept only CSV files.
 */
const fileFilter = (_req, file, cb) => {
  const allowedMimeTypes = ["text/csv", "application/csv", "text/plain"];
  const allowedExtensions = [".csv", ".txt"];
  const ext = path.extname(file.originalname).toLowerCase();

  if (allowedMimeTypes.includes(file.mimetype) || allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`File '${file.originalname}' is not a CSV file.`), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: config.maxFileSizeMB * 1024 * 1024,
  },
});

/**
 * Middleware to accept two CSV files: 'userFile' and 'exchangeFile'.
 */
const uploadFiles = upload.fields([
  { name: "userFile", maxCount: 1 },
  { name: "exchangeFile", maxCount: 1 },
]);

module.exports = { uploadFiles };
