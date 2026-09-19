import { describe, expect, it } from "vitest";
import { mapNumericConfidenceToBucket } from "./confidence-mapping";

describe("mapNumericConfidenceToBucket", () => {
  it("maps below 0.5 to low", () => {
    expect(mapNumericConfidenceToBucket(0)).toBe("low");
    expect(mapNumericConfidenceToBucket(0.49)).toBe("low");
  });

  it("maps [0.5, 0.8) to medium", () => {
    expect(mapNumericConfidenceToBucket(0.5)).toBe("medium");
    expect(mapNumericConfidenceToBucket(0.79)).toBe("medium");
  });

  it("maps [0.8, 1] to high", () => {
    expect(mapNumericConfidenceToBucket(0.8)).toBe("high");
    expect(mapNumericConfidenceToBucket(1)).toBe("high");
  });

  it("throws for an out-of-range value", () => {
    expect(() => mapNumericConfidenceToBucket(1.5)).toThrow();
    expect(() => mapNumericConfidenceToBucket(-0.1)).toThrow();
  });

  it("throws for a non-finite value", () => {
    expect(() => mapNumericConfidenceToBucket(NaN)).toThrow();
  });
});
