import type { Confidence } from "./schema";

/**
 * The single canonical conversion from a persisted, numeric confidence
 * (0.0–1.0, per `src/domain/types.ts`'s `Finding.confidence`) to a
 * benchmark confidence bucket. Every place in this module that needs to
 * go from numeric to bucketed confidence (currently just `adapter.ts`)
 * MUST use this function — duplicating the thresholds anywhere else
 * would let the two drift apart silently.
 *
 * Boundaries (closed-open, lower bound inclusive):
 *   low:    [0.00, 0.50)
 *   medium: [0.50, 0.80)
 *   high:   [0.80, 1.00]
 */
export const CONFIDENCE_BUCKET_THRESHOLDS = {
  /** Numeric confidence at or above this is "medium" (below it, "low"). */
  medium: 0.5,
  /** Numeric confidence at or above this is "high" (below it, "medium"). */
  high: 0.8,
} as const;

export function mapNumericConfidenceToBucket(numericConfidence: number): Confidence {
  if (!Number.isFinite(numericConfidence) || numericConfidence < 0 || numericConfidence > 1) {
    throw new Error(
      `mapNumericConfidenceToBucket: numericConfidence must be a finite number in [0, 1], got ${numericConfidence}`,
    );
  }
  if (numericConfidence >= CONFIDENCE_BUCKET_THRESHOLDS.high) return "high";
  if (numericConfidence >= CONFIDENCE_BUCKET_THRESHOLDS.medium) return "medium";
  return "low";
}
