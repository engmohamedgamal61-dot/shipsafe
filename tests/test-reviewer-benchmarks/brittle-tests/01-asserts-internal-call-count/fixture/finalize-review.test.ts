import { describe, expect, it, vi } from "vitest";
import * as verdictModule from "./verdict";
import { finalizeReview } from "./finalize-review";

describe("finalizeReview", () => {
  it("calls the internal helper exactly once", () => {
    const spy = vi.spyOn(verdictModule, "computeAutoMergeEligibility");
    finalizeReview("review-1");
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
