import { describe, expect, it } from "vitest";
import { totalReviewScore } from "./score";

describe("totalReviewScore", () => {
  it("sums multiple scores", () => {
    expect(totalReviewScore([1, 2, 3])).toBe(6);
  });

  it("returns the single score for a one-element array", () => {
    expect(totalReviewScore([5])).toBe(5);
  });

  it("throws for an empty array", () => {
    expect(() => totalReviewScore([])).toThrow();
  });

  it("handles negative scores", () => {
    expect(totalReviewScore([-1, 1])).toBe(0);
  });
});
