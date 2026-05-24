"use strict";

const {
  getTimestampDiffSeconds,
  isTimestampWithinTolerance,
  getQuantityDiffPct,
  isQuantityWithinTolerance,
  computeMatchScore,
} = require("../src/utils/tolerance");

describe("tolerance utilities", () => {
  // ── getTimestampDiffSeconds ──────────────────────────────────────────────
  describe("getTimestampDiffSeconds", () => {
    it("returns exact difference in seconds", () => {
      const t1 = new Date("2024-01-01T00:00:00Z");
      const t2 = new Date("2024-01-01T00:05:00Z");
      expect(getTimestampDiffSeconds(t1, t2)).toBe(300);
    });

    it("is commutative (absolute value)", () => {
      const t1 = new Date("2024-01-01T00:10:00Z");
      const t2 = new Date("2024-01-01T00:00:00Z");
      expect(getTimestampDiffSeconds(t1, t2)).toBe(600);
    });

    it("returns 0 for identical timestamps", () => {
      const t = new Date("2024-06-01T12:00:00Z");
      expect(getTimestampDiffSeconds(t, t)).toBe(0);
    });

    it("returns Infinity for non-Date inputs", () => {
      expect(getTimestampDiffSeconds("not-a-date", new Date())).toBe(Infinity);
      expect(getTimestampDiffSeconds(null, new Date())).toBe(Infinity);
    });
  });

  // ── isTimestampWithinTolerance ───────────────────────────────────────────
  describe("isTimestampWithinTolerance", () => {
    const t1 = new Date("2024-01-01T00:00:00Z");

    it("returns true when diff equals tolerance exactly", () => {
      const t2 = new Date("2024-01-01T00:05:00Z"); // exactly 300s
      expect(isTimestampWithinTolerance(t1, t2, 300)).toBe(true);
    });

    it("returns true when diff is within tolerance", () => {
      const t2 = new Date("2024-01-01T00:04:00Z"); // 240s
      expect(isTimestampWithinTolerance(t1, t2, 300)).toBe(true);
    });

    it("returns false when diff exceeds tolerance", () => {
      const t2 = new Date("2024-01-01T00:06:00Z"); // 360s
      expect(isTimestampWithinTolerance(t1, t2, 300)).toBe(false);
    });

    it("returns false for invalid dates", () => {
      expect(isTimestampWithinTolerance(new Date("invalid"), new Date(), 300)).toBe(false);
      expect(isTimestampWithinTolerance(null, new Date(), 300)).toBe(false);
    });
  });

  // ── getQuantityDiffPct ───────────────────────────────────────────────────
  describe("getQuantityDiffPct", () => {
    it("returns 0 for identical quantities", () => {
      expect(getQuantityDiffPct(100, 100)).toBe(0);
    });

    it("returns 0 for both-zero quantities", () => {
      expect(getQuantityDiffPct(0, 0)).toBe(0);
    });

    it("calculates correct percentage difference", () => {
      // |100 - 101| / 101 = 1/101 ≈ 0.0099
      const diff = getQuantityDiffPct(100, 101);
      expect(diff).toBeCloseTo(1 / 101, 10);
    });

    it("uses larger value as base", () => {
      // |50 - 100| / 100 = 0.5
      expect(getQuantityDiffPct(50, 100)).toBeCloseTo(0.5, 10);
      expect(getQuantityDiffPct(100, 50)).toBeCloseTo(0.5, 10); // commutative
    });

    it("returns Infinity for non-numeric input", () => {
      expect(getQuantityDiffPct("abc", 100)).toBe(Infinity);
      expect(getQuantityDiffPct(null, 100)).toBe(Infinity);
    });
  });

  // ── isQuantityWithinTolerance ────────────────────────────────────────────
  describe("isQuantityWithinTolerance", () => {
    it("returns true for equal quantities", () => {
      expect(isQuantityWithinTolerance(1.0, 1.0, 0.01)).toBe(true);
    });

    it("returns true when within 1% tolerance", () => {
      // 0.5% difference — should pass 1% tolerance
      expect(isQuantityWithinTolerance(100, 100.5, 0.01)).toBe(true);
    });

    it("returns false when exceeds 1% tolerance", () => {
      // ~1.96% difference — should fail 1% tolerance
      expect(isQuantityWithinTolerance(100, 102, 0.01)).toBe(false);
    });

    it("handles zero-tolerance edge case (exact match required)", () => {
      expect(isQuantityWithinTolerance(100, 100, 0)).toBe(true);
      expect(isQuantityWithinTolerance(100, 100.0001, 0)).toBe(false);
    });
  });

  // ── computeMatchScore ────────────────────────────────────────────────────
  describe("computeMatchScore", () => {
    const baseConfig = {
      timestampToleranceSeconds: 300,
      quantityTolerancePct: 0.01,
    };

    it("returns 0 for perfect match", () => {
      const score = computeMatchScore({
        ...baseConfig,
        timestampDiffSeconds: 0,
        quantityDiffPct: 0,
      });
      expect(score).toBe(0);
    });

    it("returns 2 when both at exact tolerance boundary", () => {
      const score = computeMatchScore({
        ...baseConfig,
        timestampDiffSeconds: 300,    // exactly at tolerance
        quantityDiffPct: 0.01,         // exactly at tolerance
      });
      expect(score).toBeCloseTo(2, 10);
    });

    it("returns higher score for worse match", () => {
      const good = computeMatchScore({
        ...baseConfig,
        timestampDiffSeconds: 60,
        quantityDiffPct: 0.001,
      });
      const bad = computeMatchScore({
        ...baseConfig,
        timestampDiffSeconds: 240,
        quantityDiffPct: 0.008,
      });
      expect(good).toBeLessThan(bad);
    });

    it("returns Infinity when tolerance is 0 and there is a difference", () => {
      const score = computeMatchScore({
        timestampToleranceSeconds: 0,
        quantityTolerancePct: 0,
        timestampDiffSeconds: 1,
        quantityDiffPct: 0,
      });
      expect(score).toBe(Infinity);
    });
  });
});
