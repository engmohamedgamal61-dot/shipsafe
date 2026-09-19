import { describe, expect, it } from "vitest";
import { totalReviewScore } from "./score";

describe("totalReviewScore", () => {
  it("sums two scores", () => {
    expect(totalReviewScore([1, 2])).toBe(3);
  });

  it("sums two other scores", () => {
    expect(totalReviewScore([4, 5])).toBe(9);
  });

  it("sums yet another pair of scores", () => {
    expect(totalReviewScore([10, 20])).toBe(30);
  });
});
