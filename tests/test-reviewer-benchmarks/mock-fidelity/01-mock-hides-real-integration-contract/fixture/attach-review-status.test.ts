import { describe, expect, it, vi } from "vitest";
import { attachLatestReviewStatus } from "./attach-review-status";

vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabaseClient: () => ({
    from: () => ({
      select: () => ({
        in: () => ({ data: [{ pull_request_id: "pr-1", status: "APPROVE" }], error: null }),
      }),
    }),
  }),
}));

describe("attachLatestReviewStatus", () => {
  it("attaches status to each pull request", async () => {
    const result = await attachLatestReviewStatus([{ id: "pr-1" }]);
    expect(result[0].status).toBe("APPROVE");
  });
});
