"use strict";

const { normalizeRow } = require("../src/utils/normalizer");

describe("normalizeRow", () => {
  // ── Asset normalization ─────────────────────────────────────────────────
  describe("asset normalization", () => {
    it("normalizes 'bitcoin' to 'BTC'", () => {
      const { fields } = normalizeRow({
        transaction_id: "T1",
        asset: "bitcoin",
        type: "BUY",
        quantity: "1.0",
        timestamp: "2024-01-01T00:00:00Z",
      });
      expect(fields.normalizedAsset).toBe("BTC");
    });

    it("normalizes 'ETHEREUM' to 'ETH'", () => {
      const { fields } = normalizeRow({
        transaction_id: "T1",
        asset: "ETHEREUM",
        type: "BUY",
        quantity: "1.0",
        timestamp: "2024-01-01T00:00:00Z",
      });
      expect(fields.normalizedAsset).toBe("ETH");
    });

    it("normalizes 'BTC' to 'BTC'", () => {
      const { fields } = normalizeRow({
        transaction_id: "T1",
        asset: "BTC",
        type: "BUY",
        quantity: "1.0",
        timestamp: "2024-01-01T00:00:00Z",
      });
      expect(fields.normalizedAsset).toBe("BTC");
    });

    it("flags UNKNOWN_ASSET for unrecognized assets (but still stores them)", () => {
      const { fields, issues } = normalizeRow({
        transaction_id: "T1",
        asset: "OBSCURE_COIN",
        type: "BUY",
        quantity: "1.0",
        timestamp: "2024-01-01T00:00:00Z",
      });
      expect(issues).toContain("UNKNOWN_ASSET");
      expect(fields.normalizedAsset).toBe("OBSCURE_COIN"); // uppercase as-is
    });

    it("flags MISSING_ASSET for empty asset field", () => {
      const { issues, hasBlockingIssues } = normalizeRow({
        transaction_id: "T1",
        asset: "",
        type: "BUY",
        quantity: "1.0",
        timestamp: "2024-01-01T00:00:00Z",
      });
      expect(issues).toContain("MISSING_ASSET");
      expect(hasBlockingIssues).toBe(true);
    });
  });

  // ── Type normalization ──────────────────────────────────────────────────
  describe("type normalization", () => {
    it("normalizes TRANSFER_IN to TRANSFER", () => {
      const { fields } = normalizeRow({
        transaction_id: "T1",
        asset: "BTC",
        type: "TRANSFER_IN",
        quantity: "1.0",
        timestamp: "2024-01-01T00:00:00Z",
      });
      expect(fields.normalizedType).toBe("TRANSFER");
    });

    it("normalizes TRANSFER_OUT to TRANSFER", () => {
      const { fields } = normalizeRow({
        transaction_id: "T1",
        asset: "BTC",
        type: "TRANSFER_OUT",
        quantity: "1.0",
        timestamp: "2024-01-01T00:00:00Z",
      });
      expect(fields.normalizedType).toBe("TRANSFER");
    });

    it("normalizes DEPOSIT to TRANSFER", () => {
      const { fields } = normalizeRow({
        transaction_id: "T1",
        asset: "USDT",
        type: "DEPOSIT",
        quantity: "1000",
        timestamp: "2024-01-01T00:00:00Z",
      });
      expect(fields.normalizedType).toBe("TRANSFER");
    });

    it("normalizes WITHDRAWAL to TRANSFER", () => {
      const { fields } = normalizeRow({
        transaction_id: "T1",
        asset: "USDT",
        type: "WITHDRAWAL",
        quantity: "500",
        timestamp: "2024-01-01T00:00:00Z",
      });
      expect(fields.normalizedType).toBe("TRANSFER");
    });

    it("normalizes BUY to BUY", () => {
      const { fields } = normalizeRow({
        transaction_id: "T1",
        asset: "BTC",
        type: "BUY",
        quantity: "0.5",
        timestamp: "2024-01-01T00:00:00Z",
      });
      expect(fields.normalizedType).toBe("BUY");
    });
  });

  // ── Quantity parsing ────────────────────────────────────────────────────
  describe("quantity parsing", () => {
    it("parses plain number strings", () => {
      const { fields } = normalizeRow({
        transaction_id: "T1",
        asset: "BTC",
        type: "BUY",
        quantity: "0.5",
        timestamp: "2024-01-01T00:00:00Z",
      });
      expect(fields.quantity).toBe(0.5);
    });

    it("strips commas from large numbers", () => {
      const { fields } = normalizeRow({
        transaction_id: "T1",
        asset: "USDT",
        type: "BUY",
        quantity: "1,000.50",
        timestamp: "2024-01-01T00:00:00Z",
      });
      expect(fields.quantity).toBe(1000.5);
    });

    it("flags MISSING_QUANTITY for empty quantity", () => {
      const { issues, hasBlockingIssues } = normalizeRow({
        transaction_id: "T1",
        asset: "BTC",
        type: "BUY",
        quantity: "",
        timestamp: "2024-01-01T00:00:00Z",
      });
      expect(issues).toContain("MISSING_QUANTITY");
      expect(hasBlockingIssues).toBe(true);
    });

    it("flags INVALID_QUANTITY for negative numbers", () => {
      const { issues, hasBlockingIssues } = normalizeRow({
        transaction_id: "T1",
        asset: "BTC",
        type: "BUY",
        quantity: "-5",
        timestamp: "2024-01-01T00:00:00Z",
      });
      expect(issues).toContain("INVALID_QUANTITY");
      expect(hasBlockingIssues).toBe(true);
    });
  });

  // ── Timestamp parsing ───────────────────────────────────────────────────
  describe("timestamp parsing", () => {
    it("parses ISO 8601 strings", () => {
      const { fields } = normalizeRow({
        transaction_id: "T1",
        asset: "BTC",
        type: "BUY",
        quantity: "1",
        timestamp: "2024-06-15T10:30:00Z",
      });
      expect(fields.timestamp).toBeInstanceOf(Date);
      expect(fields.timestamp.getFullYear()).toBe(2024);
    });

    it("flags INVALID_TIMESTAMP for unparseable date strings", () => {
      const { issues, hasBlockingIssues } = normalizeRow({
        transaction_id: "T1",
        asset: "BTC",
        type: "BUY",
        quantity: "1",
        timestamp: "not-a-date",
      });
      expect(issues).toContain("INVALID_TIMESTAMP");
      expect(hasBlockingIssues).toBe(true);
    });

    it("flags MISSING_TIMESTAMP for empty timestamp", () => {
      const { issues, hasBlockingIssues } = normalizeRow({
        transaction_id: "T1",
        asset: "BTC",
        type: "BUY",
        quantity: "1",
        timestamp: "",
      });
      expect(issues).toContain("MISSING_TIMESTAMP");
      expect(hasBlockingIssues).toBe(true);
    });
  });

  // ── Field aliasing ──────────────────────────────────────────────────────
  describe("field aliasing", () => {
    it("accepts 'amount' as alias for quantity", () => {
      const { fields } = normalizeRow({
        transaction_id: "T1",
        asset: "ETH",
        type: "SELL",
        amount: "2.5",
        timestamp: "2024-01-01T00:00:00Z",
      });
      expect(fields.quantity).toBe(2.5);
    });

    it("accepts 'date' as alias for timestamp", () => {
      const { fields } = normalizeRow({
        transaction_id: "T1",
        asset: "ETH",
        type: "SELL",
        quantity: "1",
        date: "2024-03-01T00:00:00Z",
      });
      expect(fields.timestamp).toBeInstanceOf(Date);
    });
  });

  // ── Full row with no issues ─────────────────────────────────────────────
  describe("clean row", () => {
    it("returns empty issues array for a perfectly clean row", () => {
      const { issues, hasBlockingIssues } = normalizeRow({
        transaction_id: "TXN001",
        asset: "BTC",
        type: "BUY",
        quantity: "0.5",
        timestamp: "2024-01-15T10:00:00Z",
      });
      expect(issues).toHaveLength(0);
      expect(hasBlockingIssues).toBe(false);
    });
  });
});
