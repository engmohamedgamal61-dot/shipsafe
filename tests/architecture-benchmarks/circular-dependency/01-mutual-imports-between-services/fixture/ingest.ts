import { recordReviewCompletion } from "@/server/demo/seed";

export async function ingestPullRequest(payload: unknown) {
  const pullRequestId = "pr-1";
  await recordReviewCompletion(pullRequestId);
  return pullRequestId;
}
