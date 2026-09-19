import { ingestPullRequest } from "@/server/github/ingest";

export async function recordReviewCompletion(pullRequestId: string) {
  console.log(`recorded ${pullRequestId}`);
}

export async function resetDemoData() {
  await ingestPullRequest({ demo: true });
}
