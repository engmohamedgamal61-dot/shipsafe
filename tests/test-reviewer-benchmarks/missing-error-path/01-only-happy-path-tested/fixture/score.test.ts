import { describe, expect, it } from "vitest";
import { totalReviewScore } from "./score";

describe("totalReviewScore", () => {
  it("sums the scores", () => {
    expect(totalReviewScore([1, 2, 3])).toBe(6);
  });
});
