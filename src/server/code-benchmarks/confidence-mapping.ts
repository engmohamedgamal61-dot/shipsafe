import type { Confidence } from "./schema";

/**
 * The Code Reviewer benchmark's own canonical numeric-confidence
 * bucketing — identical thresholds to, but a separate copy from,
 * `security-benchmarks/confidence-mapping.ts` (kept independent per
 * `tests/code-benchmarks/README.md`; both derive from the same
 * persisted `Finding.confidence` domain field, so it would be
 * surprising for the thresholds to ever diverge, but each benchmark
 * owns its own copy rather than sharing one).
 */
export const CONFIDENCE_BUCKET_THRESHOLDS = {
  medium: 0.5,
  high: 0.8,
} as const;

export function mapNumericConfidenceToBucket(numericConfidence: number): Confidence {
  if (!Number.isFinite(numericConfidence) || numericConfidence < 0 || numericConfidence > 1) {
    throw new Error(`mapNumericConfidenceToBucket: numericConfidence must be a finite number in [0, 1], got ${numericConfidence}`);
  }
  if (numericConfidence >= CONFIDENCE_BUCKET_THRESHOLDS.high) return "high";
  if (numericConfidence >= CONFIDENCE_BUCKET_THRESHOLDS.medium) return "medium";
  return "low";
}
