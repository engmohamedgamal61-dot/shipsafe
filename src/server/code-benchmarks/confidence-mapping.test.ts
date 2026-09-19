import { describe, expect, it } from "vitest";
import { mapNumericConfidenceToBucket } from "./confidence-mapping";

describe("mapNumericConfidenceToBucket", () => {
  it.each([
    [0.0, "low"],
    [0.49, "low"],
    [0.5, "medium"],
    [0.79, "medium"],
    [0.8, "high"],
    [1.0, "high"],
  ] as const)("buckets %s -> %s", (confidence, expected) => {
    expect(mapNumericConfidenceToBucket(confidence)).toBe(expected);
  });

  it("throws on an out-of-range value rather than clamping", () => {
    expect(() => mapNumericConfidenceToBucket(1.5)).toThrow();
    expect(() => mapNumericConfidenceToBucket(-0.1)).toThrow();
    expect(() => mapNumericConfidenceToBucket(Number.NaN)).toThrow();
  });
});
