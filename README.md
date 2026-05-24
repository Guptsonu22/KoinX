# KoinX Transaction Reconciliation Engine

A production-grade Node.js backend service that ingests transaction data from two sources (user-exported and exchange-exported CSVs), intelligently matches them across sources with configurable tolerances, and produces structured reconciliation reports.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Matching Strategy](#matching-strategy)
- [Setup & Running](#setup--running)
- [API Reference](#api-reference)
- [Configuration](#configuration)
- [Database Schema Design](#database-schema-design)
- [Design Decisions & Assumptions](#design-decisions--assumptions)
- [Edge Cases Handled](#edge-cases-handled)
- [Testing](#testing)
- [Project Structure](#project-structure)

---

## Overview

Crypto users often export transaction histories from multiple sources — their own records and the exchange's official export. These datasets represent the same real-world activity but **will not match perfectly** due to:

- Slight timestamp differences (processing delays, timezone issues)
- Minor quantity discrepancies (rounding, fee deductions)
- Opposite perspectives on transfers (`TRANSFER_IN` on exchange = `TRANSFER_OUT` from user's view)
- Asset name variations (`BTC` vs `Bitcoin` vs `XBT`)
- Data quality issues (missing fields, invalid dates)

This engine reconciles these datasets and classifies every transaction into one of:

| Category | Description |
|---|---|
| `MATCHED` | Successfully paired across both sources within tolerance |
| `CONFLICTING` | A pair was found but key fields differ beyond tolerance |
| `UNMATCHED_USER` | Present in user file, no match found in exchange file |
| `UNMATCHED_EXCHANGE` | Present in exchange file, no match found in user file |

---

## Architecture

```
Client (Postman / Frontend)
         │
         ▼
   Express REST API
         │
         ▼
   Controller Layer          ← Input validation, file handling
         │
         ▼
   Reconciliation Service    ← Orchestrates the full pipeline
         │
    ┌────┴────┐
    ▼         ▼
CSV Service  Matching Service
(Ingest)     (Match + Score)
    │         │
    └────┬────┘
         ▼
   Report Service            ← Build entries + generate CSV
         │
         ▼
      MongoDB
         │
         ▼
  CSV Report File (reports/)
```

### Request Flow

```
POST /reconcile
  1. Parse & ingest user CSV → Transaction collection (source: USER)
  2. Parse & ingest exchange CSV → Transaction collection (source: EXCHANGE)
  3. Run matching engine (Phase 1: exact ID → Phase 2: fuzzy)
  4. Persist ReportEntry documents per result
  5. Generate CSV report file
  6. Update ReconciliationRun with summary
  7. Return runId + summary
```

---

## Matching Strategy

This is the core of the engine. The algorithm runs in two phases:

### Phase 1 — Exact Transaction ID Match

If both the user and exchange transaction share the same `transactionId`, they are paired immediately.

After pairing, tolerances are checked:
- If both timestamp and quantity are within tolerance → **MATCHED**
- If either exceeds tolerance → **CONFLICTING**

This is the most reliable match — if IDs agree, we trust the pairing even if tolerances indicate divergence.

### Phase 2 — Fuzzy Match

For transactions without a shared ID (or missing IDs), we search by:

1. **`normalizedAsset`** must be equal (case-insensitive, alias-resolved)
2. **`normalizedType`** must be equal (after mapping equivalents like `TRANSFER_IN` → `TRANSFER`)
3. **Timestamp** must be within `TIMESTAMP_TOLERANCE_SECONDS` (default: 300s = 5 minutes)
4. **Quantity** must be within `QUANTITY_TOLERANCE_PCT` (default: 0.01 = 1%)

When **multiple exchange candidates** satisfy all four criteria for a single user transaction, we use a **composite score** to pick the best match:

```
score = (timestampDiff / timestampTolerance) + (quantityDiffPct / quantityTolerancePct)
```

Lower score = better match. This prevents greedy mismatches when multiple plausible candidates exist.

**Duplicate prevention:** Once an exchange transaction is claimed by a match (or conflict), it is removed from the candidate pool for subsequent user transactions.

### Type Mapping (Cross-Perspective Transfers)

| User Sees | Exchange Sees | Normalized To |
|---|---|---|
| `TRANSFER_OUT` | `TRANSFER_IN` | `TRANSFER` |
| `TRANSFER_IN` | `TRANSFER_OUT` | `TRANSFER` |
| `WITHDRAWAL` | `TRANSFER_IN` | `TRANSFER` |
| `DEPOSIT` | `TRANSFER_OUT` | `TRANSFER` |

---

## Setup & Running

### Prerequisites

- Node.js 18+ 
- MongoDB 6+ (local or Atlas)

### Installation

```bash
git clone <repo-url>
cd koinx-reconciliation-engine
npm install
```

### Environment Configuration

Copy the sample and update values:

```bash
cp .env.example .env
```

Edit `.env`:

```env
PORT=5000
MONGO_URI=mongodb://localhost:27017/koinx_reconciliation
TIMESTAMP_TOLERANCE_SECONDS=300
QUANTITY_TOLERANCE_PCT=0.01
LOG_LEVEL=info
NODE_ENV=development
```

### Running

```bash
# Development (with auto-reload)
npm run dev

# Production
npm start
```

The server starts at `http://localhost:5000`.

Health check: `GET http://localhost:5000/health`

---

## API Reference

### POST /reconcile

Trigger a new reconciliation run.

**Request:** `multipart/form-data`

| Field | Type | Required | Description |
|---|---|---|---|
| `userFile` | File (CSV) | ✅ | User-exported transaction CSV |
| `exchangeFile` | File (CSV) | ✅ | Exchange-exported transaction CSV |
| `timestampToleranceSeconds` | Number | ❌ | Override default timestamp tolerance |
| `quantityTolerancePct` | Number | ❌ | Override default quantity tolerance (0-1) |

**Response:**

```json
{
  "success": true,
  "runId": "run_550e8400-e29b-41d4-a716-446655440000",
  "summary": {
    "matched": 18,
    "conflicting": 2,
    "unmatchedUser": 3,
    "unmatchedExchange": 2,
    "totalUser": 23,
    "totalExchange": 22,
    "userRowsWithIssues": 3,
    "exchangeRowsWithIssues": 0
  },
  "links": {
    "report": "/report/run_550e...",
    "summary": "/report/run_550e.../summary",
    "unmatched": "/report/run_550e.../unmatched",
    "csv": "/reports/run_550e....csv"
  }
}
```

---

### GET /report/:runId

Fetch the full reconciliation report (paginated).

**Query params:** `?page=1&limit=100`

**Response:**

```json
{
  "success": true,
  "runId": "run_...",
  "status": "COMPLETED",
  "entries": [
    {
      "category": "MATCHED",
      "reason": "Transaction matched via exact transaction ID within tolerance",
      "userTransaction": { "transactionId": "TXN001", "asset": "BTC", ... },
      "exchangeTransaction": { "transactionId": "TXN001", "asset": "BTC", ... },
      "differences": { "timestampDiffSeconds": 90, "quantityDiffPct": 0.0001 }
    }
  ],
  "total": 45,
  "page": 1,
  "limit": 100,
  "totalPages": 1
}
```

---

### GET /report/:runId/summary

Fetch just the counts.

**Response:**

```json
{
  "success": true,
  "runId": "run_...",
  "status": "COMPLETED",
  "config": {
    "timestampToleranceSeconds": 300,
    "quantityTolerancePct": 0.01
  },
  "summary": {
    "matched": 18,
    "conflicting": 2,
    "unmatchedUser": 3,
    "unmatchedExchange": 2,
    "totalUser": 23,
    "totalExchange": 22,
    "userRowsWithIssues": 3,
    "exchangeRowsWithIssues": 0
  },
  "createdAt": "2024-01-15T10:00:00.000Z"
}
```

---

### GET /report/:runId/unmatched

Fetch only unmatched entries with reasons (paginated).

**Query params:** `?page=1&limit=100`

**Response:** Same structure as `/report/:runId` but filtered to `UNMATCHED_USER` and `UNMATCHED_EXCHANGE` categories.

---

### GET /health

Service health check.

---

## Configuration

All tolerances are configurable at three levels (later levels override earlier):

| Level | Mechanism | When Applied |
|---|---|---|
| 1. Code defaults | Hardcoded fallbacks | Always |
| 2. Environment variables | `.env` file / system env | On server start |
| 3. Request body | `timestampToleranceSeconds`, `quantityTolerancePct` in `POST /reconcile` body | Per-request |

| Variable | Default | Description |
|---|---|---|
| `TIMESTAMP_TOLERANCE_SECONDS` | `300` | Max seconds difference between matched timestamps |
| `QUANTITY_TOLERANCE_PCT` | `0.01` | Max fractional quantity difference (0.01 = 1%) |
| `PORT` | `5000` | Server port |
| `MONGO_URI` | `mongodb://localhost:27017/koinx_reconciliation` | MongoDB connection string |
| `LOG_LEVEL` | `info` | Winston log level (error/warn/info/debug) |
| `MAX_FILE_SIZE_MB` | `50` | Maximum upload file size |

---

## Database Schema Design

### Why Three Collections?

1. **`transactions`** — The source of truth for all ingested rows. Kept separate from results so re-reconciliation of the same data is possible.
2. **`reconciliationruns`** — Tracks run metadata, config, and summary counts. Enables querying run history.
3. **`reportentries`** — Each report result as a document. Makes the `/report/:runId` and `/report/:runId/unmatched` APIs fast O(1) range queries instead of requiring computation on each request.

### Transaction Document

```json
{
  "source": "USER",
  "reconciliationRunId": "run_abc123",
  "transactionId": "TXN001",
  "asset": "bitcoin",
  "normalizedAsset": "BTC",
  "type": "BUY",
  "normalizedType": "BUY",
  "quantity": 0.5,
  "timestamp": "2024-01-15T10:00:00.000Z",
  "rawRow": { "...": "original CSV row" },
  "ingestionIssues": [],
  "hasBlockingIssues": false,
  "reconciliationStatus": "MATCHED",
  "matchedTransactionId": "ObjectId(...)"
}
```

### Indexes

- `(reconciliationRunId, source, normalizedAsset)` — fuzzy match lookup
- `(reconciliationRunId, transactionId)` — exact ID match lookup
- `(runId, category)` on ReportEntry — filtered API queries

---

## Design Decisions & Assumptions

### 1. Two-Pass Matching (Exact ID First)

**Decision:** Run exact ID matching before fuzzy matching.

**Reason:** Exact ID matches are authoritative. Running them first prevents fuzzy matching from "stealing" a correct ID match. This also reduces the candidate pool for Phase 2, improving performance.

### 2. Score-Based Candidate Selection

**Decision:** When multiple fuzzy candidates exist, use a composite score rather than first-match.

**Reason:** Greedy first-match can produce suboptimal pairings. The scoring formula normalizes both dimensions to the same scale, giving equal weight to timestamp and quantity closeness.

### 3. Never Drop Bad Rows

**Decision:** All CSV rows (even invalid ones) are stored in MongoDB with `ingestionIssues` flags.

**Reason:** The assignment explicitly requires this. In production, losing transaction data silently is unacceptable — every row must be auditable.

### 4. `hasBlockingIssues` Prevents Matching

**Decision:** Rows with `MISSING_ASSET`, `MISSING_TYPE`, `MISSING_QUANTITY`, `INVALID_QUANTITY`, or `MISSING_TIMESTAMP`/`INVALID_TIMESTAMP` are flagged `hasBlockingIssues: true` and routed directly to UNMATCHED.

**Reason:** Without asset, type, quantity, or timestamp, no meaningful comparison can be made.

### 5. TRANSFER_IN = TRANSFER_OUT (Same Transaction)

**Decision:** Both sides normalize to `TRANSFER`.

**Reason:** A user sends funds (TRANSFER_OUT), the exchange receives them (TRANSFER_IN). These are the same transaction viewed from opposite perspectives.

### 6. ReportEntry as Separate Collection

**Decision:** Store each result row as a MongoDB document, not just in a CSV.

**Reason:** Enables efficient paginated API queries by category without re-reading the CSV file on every request.

### 7. CSV Report File Also Generated

**Decision:** Generate a physical CSV file at `reports/{runId}.csv` in addition to DB records.

**Reason:** The assignment explicitly requires CSV output. Also useful for download/sharing.

### 8. Pagination on Report APIs

**Decision:** Add `?page=1&limit=100` to report endpoints.

**Reason:** Production datasets can have millions of rows. Returning everything in one response is not viable.

### 9. Asset Aliases

**Decision:** Maintain a static alias map in code.

**Assumption:** A curated set of common aliases covers 95%+ of real-world data. Unknown assets are flagged with `UNKNOWN_ASSET` but still stored and can be matched by their uppercase value if both sides use the same unknown alias.

---

## Edge Cases Handled

| Edge Case | Handling |
|---|---|
| Missing `transaction_id` | Flagged as `MISSING_TRANSACTION_ID`; falls through to fuzzy matching |
| Invalid/unparseable timestamp | Flagged as `INVALID_TIMESTAMP`; row marked `hasBlockingIssues: true` → UNMATCHED |
| Negative quantity | Flagged as `INVALID_QUANTITY`; `hasBlockingIssues: true` |
| Comma-formatted numbers (`1,000.50`) | Stripped before parsing |
| Column name aliases (`amount` vs `quantity`) | Case-insensitive field lookup with candidate list |
| Asset case variations (`btc`, `BTC`, `Bitcoin`) | All resolve to `BTC` via alias map |
| `TRANSFER_IN` vs `TRANSFER_OUT` | Both normalize to `TRANSFER` |
| `DEPOSIT`/`WITHDRAWAL` as transfer equivalents | Both normalize to `TRANSFER` |
| Multiple fuzzy candidates for one user txn | Scored; lowest-score candidate wins |
| Exchange txn matched to multiple user txns | Prevented by `matchedExchangeIds` set |
| Empty CSV rows | Skipped after checking all values are empty |
| Unix epoch timestamps (seconds/ms) | Detected by magnitude heuristic and converted |
| Run fails mid-way | `ReconciliationRun.status` set to `FAILED` with `errorMessage` |

---

## Testing

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch
```

### Test Coverage

| File | What's Tested |
|---|---|
| `tests/tolerance.test.js` | All tolerance helper functions with edge cases |
| `tests/normalizer.test.js` | Asset/type normalization, quantity parsing, timestamp parsing, field aliasing |
| `tests/matching.test.js` | Matching logic decisions (tolerance checks, scoring, type equivalence) |

---

## Project Structure

```
koinx-reconciliation-engine/
│
├── src/
│   ├── app.js                          ← Express app setup
│   │
│   ├── config/
│   │   └── config.js                   ← Environment config loader
│   │
│   ├── controllers/
│   │   └── reconciliation.controller.js ← HTTP handlers
│   │
│   ├── database/
│   │   └── connection.js               ← MongoDB connection
│   │
│   ├── middleware/
│   │   ├── error.middleware.js          ← Global error handler
│   │   └── upload.middleware.js         ← Multer CSV upload
│   │
│   ├── models/
│   │   ├── Transaction.js              ← Transaction schema
│   │   ├── ReconciliationRun.js        ← Run metadata schema
│   │   └── ReportEntry.js             ← Report result schema
│   │
│   ├── routes/
│   │   └── reconciliation.routes.js    ← Route definitions
│   │
│   ├── services/
│   │   ├── csv.service.js              ← CSV parse & ingest
│   │   ├── matching.service.js         ← Matching engine
│   │   ├── reconciliation.service.js   ← Pipeline orchestrator
│   │   └── report.service.js           ← Report generation & queries
│   │
│   └── utils/
│       ├── assetAliases.js             ← Crypto asset alias map
│       ├── logger.js                   ← Winston logger
│       ├── normalizer.js               ← Row normalization
│       ├── tolerance.js                ← Tolerance helpers
│       └── typeMappings.js             ← Transaction type map
│
├── tests/
│   ├── tolerance.test.js
│   ├── normalizer.test.js
│   └── matching.test.js
│
├── uploads/                            ← Temp CSV uploads (gitignored)
├── reports/                            ← Generated CSV reports (gitignored)
├── logs/                               ← Winston log files (gitignored)
│
├── .env                                ← Environment variables (gitignored)
├── .env.example                        ← Template for .env
├── .gitignore
├── package.json
├── README.md
└── server.js                           ← Entry point
```

---

## Commit History Convention

This project follows conventional commits:

```
feat: initialize express server and health endpoint
feat: add mongodb connection with error handling
feat: add transaction, reconciliation-run, and report-entry schemas
feat: implement asset alias map and type normalization utilities
feat: add tolerance helpers with composite scoring
feat: implement streaming csv ingestion with data quality flagging
feat: build two-phase matching engine (exact ID + fuzzy)
feat: implement report service with csv generation
feat: add reconciliation orchestrator service
feat: add rest api endpoints and multer upload middleware
test: add unit tests for tolerance helpers
test: add unit tests for row normalizer
test: add unit tests for matching logic
docs: add comprehensive readme with architecture and api docs
```
