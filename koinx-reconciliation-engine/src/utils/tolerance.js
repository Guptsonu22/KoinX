"use strict";

/**
 * Tolerance helper functions for the matching engine.
 *
 * All functions are pure (no side effects) and thoroughly testable.
 */

/**
 * Calculate the absolute difference in seconds between two Date objects.
 *
 * @param {Date} ts1
 * @param {Date} ts2
 * @returns {number} Absolute difference in seconds
 */
const getTimestampDiffSeconds = (ts1, ts2) => {
  if (!(ts1 instanceof Date) || !(ts2 instanceof Date)) {
    return Infinity;
  }
  return Math.abs(ts1.getTime() - ts2.getTime()) / 1000;
};

/**
 * Check whether two timestamps are within the given tolerance window.
 *
 * @param {Date} ts1
 * @param {Date} ts2
 * @param {number} toleranceSeconds
 * @returns {boolean}
 */
const isTimestampWithinTolerance = (ts1, ts2, toleranceSeconds) => {
  if (!(ts1 instanceof Date) || !(ts2 instanceof Date)) return false;
  if (isNaN(ts1.getTime()) || isNaN(ts2.getTime())) return false;
  return getTimestampDiffSeconds(ts1, ts2) <= toleranceSeconds;
};

/**
 * Calculate the percentage difference between two quantities.
 * Uses the larger value as the base to avoid division-by-zero edge cases.
 *
 * @param {number} q1
 * @param {number} q2
 * @returns {number} Percentage difference (0–1 scale, e.g., 0.02 = 2%)
 */
const getQuantityDiffPct = (q1, q2) => {
  if (typeof q1 !== "number" || typeof q2 !== "number") return Infinity;
  const base = Math.max(Math.abs(q1), Math.abs(q2));
  if (base === 0) return 0; // both are 0 → perfect match
  return Math.abs(q1 - q2) / base;
};

/**
 * Check whether two quantities are within the given percentage tolerance.
 *
 * @param {number} q1
 * @param {number} q2
 * @param {number} tolerancePct - e.g., 0.01 for 1%
 * @returns {boolean}
 */
const isQuantityWithinTolerance = (q1, q2, tolerancePct) => {
  if (typeof q1 !== "number" || typeof q2 !== "number") return false;
  return getQuantityDiffPct(q1, q2) <= tolerancePct;
};

/**
 * Compute a composite match score (lower is better).
 * Used to pick the best fuzzy match when multiple candidates exist.
 *
 * Scoring:
 *   - Timestamp component: normalized to [0, 1] against the tolerance
 *   - Quantity component:  normalized to [0, 1] against the tolerance
 *
 * If timestamp or quantity is outside tolerance the score will be > 1
 * (indicating a bad match, not filtered here — caller decides).
 *
 * @param {object} params
 * @param {number} params.timestampDiffSeconds
 * @param {number} params.quantityDiffPct
 * @param {number} params.timestampToleranceSeconds
 * @param {number} params.quantityTolerancePct
 * @returns {number}
 */
const computeMatchScore = ({
  timestampDiffSeconds,
  quantityDiffPct,
  timestampToleranceSeconds,
  quantityTolerancePct,
}) => {
  const tsScore =
    timestampToleranceSeconds > 0
      ? timestampDiffSeconds / timestampToleranceSeconds
      : timestampDiffSeconds === 0
      ? 0
      : Infinity;

  const qScore =
    quantityTolerancePct > 0
      ? quantityDiffPct / quantityTolerancePct
      : quantityDiffPct === 0
      ? 0
      : Infinity;

  // Equal weighting; could be tuned
  return tsScore + qScore;
};

module.exports = {
  getTimestampDiffSeconds,
  isTimestampWithinTolerance,
  getQuantityDiffPct,
  isQuantityWithinTolerance,
  computeMatchScore,
};
