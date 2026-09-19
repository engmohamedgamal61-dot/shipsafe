"use server";

import { getReviewRepository } from "@/server/container";

export async function finalizeReview(reviewId: string) {
  const repo = getReviewRepository();
  const review = await repo.getReviewById("system", reviewId);
  if (!review) return { ok: false };

  let verdict: "APPROVE" | "APPROVE_WITH_MINOR_FIXES" | "DO_NOT_APPROVE" = "APPROVE";
  const requiredReviewers = ["code", "security", "database"];
  for (const kind of requiredReviewers) {
    const run = review.reviewerRuns.find((r) => r.reviewer === kind);
    if (!run || run.status !== "complete") {
      verdict = "DO_NOT_APPROVE";
    }
  }
  const hasP0 = review.findings.some((f) => f.severity === "P0");
  if (hasP0) verdict = "DO_NOT_APPROVE";

  return { ok: true, verdict };
}
