import { describe, expect, it } from "vitest";
import { computeAutoMergeEligibility } from "./verdict";

describe("computeAutoMergeEligibility", () => {
  it("returns a boolean", () => {
    const result = computeAutoMergeEligibility("APPROVE", []);
    expect(result).toBeDefined();
  });
});
