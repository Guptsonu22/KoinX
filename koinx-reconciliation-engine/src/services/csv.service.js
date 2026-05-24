"use strict";

const fs = require("fs");
const path = require("path");
const csvParser = require("csv-parser");

const Transaction = require("../models/Transaction");
const { normalizeRow } = require("../utils/normalizer");
const logger = require("../utils/logger");

/**
 * Parse a CSV file and ingest all rows into the Transaction collection.
 *
 * Key behaviours:
 *  - Uses streaming parser to handle large
 *  files efficiently
 *  - Validates and normalizes every row
 *  - NEVER drops rows silently — bad rows are stored with ingestionIssues
 *  - Returns a summary of what was ingested
 *
 * @param {string} filePath   - Absolute path to the CSV file
 * @param {"USER"|"EXCHANGE"} source
 * @param {string} runId
 * @returns {Promise<{ total: number, rowsWithIssues: number, transactions: Transaction[] }>}
 */
const parseAndIngestCSV = (filePath, source, runId) => {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) {
      return reject(new Error(`File not found: ${filePath}`));
    }

    const transactions = [];
    const rowErrors = [];
    let rowIndex = 0;

    logger.info(`[CSV] Starting ingestion of ${source} file: ${path.basename(filePath)}`);

    fs.createReadStream(filePath)
      .pipe(
        csvParser({
          // Trim whitespace from headers and values
          mapHeaders: ({ header }) => header.trim().toLowerCase(),
          mapValues: ({ value }) => (value !== undefined ? value.trim() : value),
          // Skip completely empty lines
          skipEmptyLines: true,
        })
      )
      .on("data", (rawRow) => {
        rowIndex++;
        const lineNum = rowIndex + 1; // +1 for header

        try {
          // Skip rows where all values are empty (blank lines that slipped through)
          const nonEmptyValues = Object.values(rawRow).filter(
            (v) => v !== null && v !== undefined && String(v).trim() !== ""
          );
          if (nonEmptyValues.length === 0) {
            logger.debug(`[CSV][${source}] Row ${lineNum}: skipping truly empty row`);
            return;
          }

          // Normalize and validate the row
          const { fields, issues, hasBlockingIssues } = normalizeRow(rawRow);

          if (issues.length > 0) {
            logger.warn(
              `[CSV][${source}] Row ${lineNum} has issues: [${issues.join(", ")}] — Raw: ${JSON.stringify(rawRow)}`
            );
          }

          transactions.push({
            source,
            reconciliationRunId: runId,
            transactionId: fields.transactionId,
            asset: fields.asset,
            normalizedAsset: fields.normalizedAsset,
            type: fields.type,
            normalizedType: fields.normalizedType,
            quantity: fields.quantity,
            timestamp: fields.timestamp,
            rawRow,
            ingestionIssues: issues,
            hasBlockingIssues,
            reconciliationStatus: "PENDING",
          });
        } catch (err) {
          logger.error(`[CSV][${source}] Row ${lineNum} threw unexpected error: ${err.message}`);
          rowErrors.push({ lineNum, rawRow, error: err.message });
        }
      })
      .on("error", (err) => {
        logger.error(`[CSV][${source}] Stream error: ${err.message}`);
        reject(err);
      })
      .on("end", async () => {
        logger.info(
          `[CSV][${source}] Parsed ${transactions.length} rows (${rowErrors.length} unexpected errors)`
        );

        if (transactions.length === 0) {
          logger.warn(`[CSV][${source}] No rows to insert.`);
          return resolve({ total: 0, rowsWithIssues: 0, transactions: [] });
        }

        try {
          // Bulk insert for performance
          const inserted = await Transaction.insertMany(transactions, {
            ordered: false, // continue inserting even if some fail
          });

          const rowsWithIssues = inserted.filter(
            (t) => t.ingestionIssues && t.ingestionIssues.length > 0
          ).length;

          logger.info(
            `[CSV][${source}] Inserted ${inserted.length} transactions (${rowsWithIssues} with issues)`
          );

          resolve({
            total: inserted.length,
            rowsWithIssues,
            transactions: inserted,
          });
        } catch (dbErr) {
          logger.error(`[CSV][${source}] DB insert error: ${dbErr.message}`);
          reject(dbErr);
        }
      });
  });
};

module.exports = { parseAndIngestCSV };
