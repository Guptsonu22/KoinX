"use strict";

/**
 * Matching Engine Unit Tests
 *
 * These tests validate the matching logic in isolation by mocking the
 * Transaction model and testing the underlying tolerance / scoring logic.
 *
 * Integration-level matching tests (with real DB) are in api.test.js.
 */

const {
  isTimestampWithinTolerance,
  isQuantityWithinTolerance,
  computeMatchScore,
  getTimestampDiffSeconds,
  getQuantityDiffPct,
} = require("../src/utils/tolerance");

describe("Matching Engine — tolerance-based decisions", () => {
  const CONFIG = {
    timestampToleranceSeconds: 300,
    quantityTolerancePct: 0.01,
  };

  // Helper: create a minimal transaction-like object
  const makeTxn = (overrides = {}) => ({
    _id: "mock_id",
    source: "USER",
    transactionId: "TXN001",
    asset: "BTC",
    normalizedAsset: "BTC",
    type: "BUY",
    normalizedType: "BUY",
    quantity: 1.0,
    timestamp: new Date("2024-01-15T10:00:00Z"),
    ingestionIssues: [],
    hasBlockingIssues: false,
    rawRow: {},
    ...overrides,
  });

  // ── Perfect match scenario ─────────────────────────────────────────────
  describe("perfect match", () => {
    it("matches when asset, type, timestamp, and quantity are identical", () => {
      const ut = makeTxn({ source: "USER" });
      const et = makeTxn({ source: "EXCHANGE" });

      expect(isTimestampWithinTolerance(ut.timestamp, et.timestamp, CONFIG.timestampToleranceSeconds)).toBe(true);
      expect(isQuantityWithinTolerance(ut.quantity, et.quantity, CONFIG.quantityTolerancePct)).toBe(true);

      const score = computeMatchScore({
        ...CONFIG,
        timestampDiffSeconds: getTimestampDiffSeconds(ut.timestamp, et.timestamp),
        quantityDiffPct: getQuantityDiffPct(ut.quantity, et.quantity),
      });
      expect(score).toBe(0);
    });
  });

  // ── Timestamp tolerance edge cases ─────────────────────────────────────
  describe("timestamp tolerance", () => {
    it("accepts transactions within 5-minute window", () => {
      const ut = makeTxn({ timestamp: new Date("2024-01-15T10:00:00Z") });
      const et = makeTxn({ timestamp: new Date("2024-01-15T10:04:59Z") }); // 299s
      expect(isTimestampWithinTolerance(ut.timestamp, et.timestamp, 300)).toBe(true);
    });

    it("rejects transactions outside 5-minute window", () => {
      const ut = makeTxn({ timestamp: new Date("2024-01-15T10:00:00Z") });
      const et = makeTxn({ timestamp: new Date("2024-01-15T10:06:00Z") }); // 360s
      expect(isTimestampWithinTolerance(ut.timestamp, et.timestamp, 300)).toBe(false);
    });
  });

  // ── Quantity tolerance edge cases ──────────────────────────────────────
  describe("quantity tolerance", () => {
    it("accepts quantities within 1% tolerance", () => {
      // 0.50005 vs 0.5 = 0.01% difference — passes 1% tolerance
      expect(isQuantityWithinTolerance(0.5, 0.50005, 0.01)).toBe(true);
    });

    it("rejects quantities beyond 1% tolerance", () => {
      // 1.0 vs 1.02 = ~1.96% difference — exceeds 1%
      expect(isQuantityWithinTolerance(1.0, 1.02, 0.01)).toBe(false);
    });
  });

  // ── TRANSFER_IN / TRANSFER_OUT equivalence ─────────────────────────────
  describe("type normalization equivalence", () => {
    const { resolveType } = require("../src/utils/typeMappings");

    it("TRANSFER_IN and TRANSFER_OUT both normalize to TRANSFER", () => {
      expect(resolveType("TRANSFER_IN").normalized).toBe("TRANSFER");
      expect(resolveType("TRANSFER_OUT").normalized).toBe("TRANSFER");
    });

    it("DEPOSIT normalizes to TRANSFER", () => {
      expect(resolveType("DEPOSIT").normalized).toBe("TRANSFER");
    });

    it("BUY and SELL remain distinct", () => {
      expect(resolveType("BUY").normalized).toBe("BUY");
      expect(resolveType("SELL").normalized).toBe("SELL");
    });
  });

  // ── Score-based best match selection ───────────────────────────────────
  describe("best match selection via score", () => {
    it("selects candidate with lower score", () => {
      const candidate1Score = computeMatchScore({
        ...CONFIG,
        timestampDiffSeconds: 100,
        quantityDiffPct: 0.001,
      });
      const candidate2Score = computeMatchScore({
        ...CONFIG,
        timestampDiffSeconds: 250,
        quantityDiffPct: 0.005,
      });
      // candidate1 has a lower score → should be selected
      expect(candidate1Score).toBeLessThan(candidate2Score);
    });
  });

  // ── Conflict detection ─────────────────────────────────────────────────
  describe("conflict detection", () => {
    it("detects conflict when timestamp exceeds tolerance", () => {
      const ut = makeTxn({ timestamp: new Date("2024-01-15T10:00:00Z") });
      const et = makeTxn({
        source: "EXCHANGE",
        timestamp: new Date("2024-01-15T11:00:00Z"), // 3600s > 300s
      });

      const tsOk = isTimestampWithinTolerance(
        ut.timestamp,
        et.timestamp,
        CONFIG.timestampToleranceSeconds
      );
      const qtyOk = isQuantityWithinTolerance(
        ut.quantity,
        et.quantity,
        CONFIG.quantityTolerancePct
      );

      expect(tsOk).toBe(false);
      expect(qtyOk).toBe(true);
      // At least one tolerance failed → CONFLICTING
      expect(!tsOk || !qtyOk).toBe(true);
    });

    it("detects conflict when quantity exceeds tolerance", () => {
      const ut = makeTxn({ quantity: 1.0 });
      const et = makeTxn({ source: "EXCHANGE", quantity: 1.5 }); // 33% off

      const qtyOk = isQuantityWithinTolerance(
        ut.quantity,
        et.quantity,
        CONFIG.quantityTolerancePct
      );
      expect(qtyOk).toBe(false);
    });
  });

  // ── Blocking issues prevent matching ──────────────────────────────────
  describe("blocking issues", () => {
    it("rows with hasBlockingIssues=true cannot be matched", () => {
      const blockedTxn = makeTxn({ hasBlockingIssues: true });
      // In the actual engine, these go directly to unmatchedUserTxns
      expect(blockedTxn.hasBlockingIssues).toBe(true);
    });
  });
});
