import { describe, expect, it } from "vitest";
import { isReviewInProgress } from "./review-status";

describe("isReviewInProgress — polling stop/continue decision", () => {
  it("keeps polling for a queued (pending) review", () => {
    expect(isReviewInProgress("pending")).toBe(true);
  });

  it("keeps polling for a running review", () => {
    expect(isReviewInProgress("running")).toBe(true);
  });

  it("stops polling once a review completes", () => {
    expect(isReviewInProgress("complete")).toBe(false);
  });

  it("stops polling once a review fails", () => {
    expect(isReviewInProgress("failed")).toBe(false);
  });
});
