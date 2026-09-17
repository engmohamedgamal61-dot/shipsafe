import type { PullRequest, Repository, ReviewWithContext } from "@/domain/types";
import { ReviewOrchestrator, attachReviewIds } from "@/server/review-engine/orchestrator";
import { MockAIProvider } from "@/server/review-engine/providers/mock-provider";
import { MockReleaseJudgeProvider } from "@/server/review-engine/providers/judge-provider";
import { REVIEW_RULE_VERSION } from "@/server/review-engine/version";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/server/auth/demo-adapter";
import {
  DEMO_CHANGED_FILES,
  DEMO_DIFF_TEXT,
  DEMO_PR_AUTHOR,
  DEMO_PR_BASE_SHA,
  DEMO_PR_HEAD_SHA,
  DEMO_PR_NUMBER,
  DEMO_PR_SOURCE_BRANCH,
  DEMO_PR_TARGET_BRANCH,
  DEMO_PR_TITLE,
} from "./fixture-pr";

const DEMO_REPOSITORY_ID = "10000000-0000-0000-0000-000000000001";
const DEMO_PULL_REQUEST_ID = "20000000-0000-0000-0000-000000000001";
const DEMO_REVIEW_ID = "30000000-0000-0000-0000-000000000001";

/** userId -> workspaceId. Phase 1 has exactly one user and one personal workspace. */
export function workspaceIdForUser(userId: string): string | null {
  return userId === DEMO_USER_ID ? DEMO_WORKSPACE_ID : null;
}

/**
 * The demo review is computed once per server process (by the real
 * review engine, against the real fixture diff) and cached, so every
 * request sees the same review with stable ids instead of re-running the
 * heuristics — and paying non-determinism in ids — on every page load.
 */
let cached: Promise<ReviewWithContext> | null = null;

export function getDemoReview(): Promise<ReviewWithContext> {
  if (!cached) {
    cached = buildDemoReview();
  }
  return cached;
}

async function buildDemoReview(): Promise<ReviewWithContext> {
  const repository: Repository = {
    id: DEMO_REPOSITORY_ID,
    workspaceId: DEMO_WORKSPACE_ID,
    provider: "demo",
    externalId: null,
    githubInstallationId: null,
    name: "payments-service",
    fullName: "acme/payments-service",
    defaultBranch: "main",
    connectedAt: new Date().toISOString(),
  };

  const pullRequest: PullRequest = {
    id: DEMO_PULL_REQUEST_ID,
    repositoryId: repository.id,
    externalId: null,
    number: DEMO_PR_NUMBER,
    title: DEMO_PR_TITLE,
    sourceBranch: DEMO_PR_SOURCE_BRANCH,
    targetBranch: DEMO_PR_TARGET_BRANCH,
    authorLogin: DEMO_PR_AUTHOR,
    changedFiles: DEMO_CHANGED_FILES,
    diffText: DEMO_DIFF_TEXT,
    headSha: DEMO_PR_HEAD_SHA,
    baseSha: DEMO_PR_BASE_SHA,
    openedAt: new Date().toISOString(),
  };

  const orchestrator = new ReviewOrchestrator(new MockAIProvider(), new MockReleaseJudgeProvider());
  const result = await orchestrator.run({
    pullRequestTitle: pullRequest.title,
    sourceBranch: pullRequest.sourceBranch,
    targetBranch: pullRequest.targetBranch,
    changedFiles: pullRequest.changedFiles,
    diffText: pullRequest.diffText,
    diffTruncated: false,
    changedFilesTruncated: false,
  });

  const reviewerRuns = attachReviewIds(DEMO_REVIEW_ID, result.reviewerRuns);

  return {
    id: DEMO_REVIEW_ID,
    pullRequestId: pullRequest.id,
    status: result.status,
    verdict: result.verdict,
    summary: result.summary,
    failureReason: result.failureReason,
    reviewedHeadSha: pullRequest.headSha,
    reviewedBaseSha: pullRequest.baseSha,
    ruleVersion: REVIEW_RULE_VERSION,
    promptVersion: null,
    diffTruncated: false,
    changedFilesTruncated: false,
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    reviewerRuns,
    pullRequest,
    repository,
  };
}
