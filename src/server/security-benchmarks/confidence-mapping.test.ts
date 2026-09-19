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
  ] as const)("maps %s -> %s", (numericConfidence, expectedBucket) => {
    expect(mapNumericConfidenceToBucket(numericConfidence)).toBe(expectedBucket);
  });

  it("treats 0.499999 as low (just under the medium threshold)", () => {
    expect(mapNumericConfidenceToBucket(0.499999)).toBe("low");
  });

  it("treats 0.799999 as medium (just under the high threshold)", () => {
    expect(mapNumericConfidenceToBucket(0.799999)).toBe("medium");
  });

  it.each([-0.01, 1.01, NaN, Infinity, -Infinity])("throws for an out-of-range or non-finite value %s", (value) => {
    expect(() => mapNumericConfidenceToBucket(value)).toThrow();
  });
});
