import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GithubPullRequestWebhookBody } from "./types";

/**
 * Everything `handlePullRequestEvent`/`processPendingReviews` talk to
 * outside the pure request body (GitHub API client, Supabase writes, the
 * AI provider) is mocked here so this stays a fast, focused unit test of
 * the webhook-vs-worker split rather than a full integration test.
 */
const {
  upsertPullRequestMock,
  findOrCreatePendingReviewMock,
  completeReviewMock,
  claimNextPendingReviewMock,
  getPullRequestByIdMock,
  failReviewMock,
  getAIProviderMock,
  getReleaseJudgePortMock,
} = vi.hoisted(() => ({
  upsertPullRequestMock: vi.fn().mockResolvedValue({ id: "pr-row-1" }),
  findOrCreatePendingReviewMock: vi.fn(),
  completeReviewMock: vi.fn().mockResolvedValue(undefined),
  claimNextPendingReviewMock: vi.fn(),
  getPullRequestByIdMock: vi.fn(),
  failReviewMock: vi.fn().mockResolvedValue(undefined),
  getAIProviderMock: vi.fn(),
  getReleaseJudgePortMock: vi.fn(),
}));

vi.mock("./writes", () => ({
  upsertPullRequest: upsertPullRequestMock,
  findOrCreatePendingReview: findOrCreatePendingReviewMock,
  completeReview: completeReviewMock,
  claimNextPendingReview: claimNextPendingReviewMock,
  getPullRequestById: getPullRequestByIdMock,
  failReview: failReviewMock,
  getRepositoryByExternalId: vi.fn().mockResolvedValue({ id: "repo-row-1" }),
  upsertRepository: vi.fn(),
  upsertInstallation: vi.fn(),
  deleteInstallation: vi.fn(),
  setInstallationSuspended: vi.fn(),
  removeRepositoryByExternalId: vi.fn(),
  getInstallationWorkspaceId: vi.fn(),
  getInstallationRowId: vi.fn(),
}));

vi.mock("./client", () => ({
  getInstallationToken: vi.fn().mockResolvedValue("fake-token"),
  fetchPullRequestDiff: vi.fn().mockResolvedValue(""),
  fetchPullRequestFiles: vi.fn().mockResolvedValue([]),
}));

// getAIProvider/getReleaseJudgePort are spies (not just plain factories) so
// tests can assert whether the webhook path ever touches them at all —
// that's the direct proof it never runs the AI pipeline inline. When they
// ARE invoked (by processPendingReviews / the worker), they still return
// the real deterministic mock providers, so the REAL ReviewOrchestrator
// runs end-to-end rather than being stubbed out.
vi.mock("@/server/container", async () => {
  const { MockAIProvider } = await import("@/server/review-engine/providers/mock-provider");
  const { MockReleaseJudgeProvider } = await import("@/server/review-engine/providers/judge-provider");
  getAIProviderMock.mockImplementation(() => new MockAIProvider());
  getReleaseJudgePortMock.mockImplementation(() => new MockReleaseJudgeProvider());
  return {
    getAIProvider: getAIProviderMock,
    getReleaseJudgePort: getReleaseJudgePortMock,
  };
});

const { handlePullRequestEvent, processPendingReviews } = await import("./ingest");

function webhookBody(overrides: {
  action: string;
  headSha: string;
  createdAt: string;
}): GithubPullRequestWebhookBody {
  return {
    action: overrides.action,
    installation: { id: 1 },
    repository: {
      id: 555,
      name: "payments-service",
      full_name: "acme/payments-service",
      default_branch: "main",
      owner: { login: "acme", type: "Organization" },
    },
    pull_request: {
      id: 10,
      number: 42,
      title: "Add retry logic",
      user: { login: "octocat" },
      head: { sha: overrides.headSha, ref: "feat/retry" },
      base: { sha: "base-sha", ref: "main" },
      created_at: overrides.createdAt,
    },
  };
}

beforeEach(() => {
  upsertPullRequestMock.mockClear();
  findOrCreatePendingReviewMock.mockReset().mockResolvedValue({ id: "review-1", alreadyExisted: false });
  completeReviewMock.mockClear();
  claimNextPendingReviewMock.mockReset();
  getPullRequestByIdMock.mockReset();
  failReviewMock.mockClear();
  getAIProviderMock.mockClear();
  getReleaseJudgePortMock.mockClear();
});

describe("handlePullRequestEvent — created_at ingestion", () => {
  it("passes the real GitHub pull_request.created_at through as openedAt on an 'opened' event", async () => {
    await handlePullRequestEvent(
      webhookBody({ action: "opened", headSha: "sha-1", createdAt: "2026-09-10T08:15:00Z" }),
    );

    expect(upsertPullRequestMock).toHaveBeenCalledTimes(1);
    expect(upsertPullRequestMock.mock.calls[0][0]).toMatchObject({
      openedAt: "2026-09-10T08:15:00Z",
      headSha: "sha-1",
    });
  });

  it("preserves the original creation timestamp on a later 'synchronize' event for the same PR", async () => {
    const createdAt = "2026-09-10T08:15:00Z";

    await handlePullRequestEvent(webhookBody({ action: "opened", headSha: "sha-1", createdAt }));
    await handlePullRequestEvent(webhookBody({ action: "synchronize", headSha: "sha-2", createdAt }));

    expect(upsertPullRequestMock).toHaveBeenCalledTimes(2);
    const openedCall = upsertPullRequestMock.mock.calls[0][0];
    const synchronizeCall = upsertPullRequestMock.mock.calls[1][0];

    expect(openedCall.openedAt).toBe(createdAt);
    expect(synchronizeCall.openedAt).toBe(createdAt);
    expect(synchronizeCall.headSha).toBe("sha-2");
  });

  it("also preserves it on a 'reopened' event", async () => {
    await handlePullRequestEvent(
      webhookBody({ action: "reopened", headSha: "sha-1", createdAt: "2026-09-10T08:15:00Z" }),
    );

    expect(upsertPullRequestMock.mock.calls[0][0]).toMatchObject({ openedAt: "2026-09-10T08:15:00Z" });
  });
});

describe("handlePullRequestEvent — never runs the AI pipeline inline", () => {
  it("resolves without ever calling getAIProvider or getReleaseJudgePort", async () => {
    await handlePullRequestEvent(
      webhookBody({ action: "synchronize", headSha: "sha-1", createdAt: "2026-09-10T08:15:00Z" }),
    );

    expect(getAIProviderMock).not.toHaveBeenCalled();
    expect(getReleaseJudgePortMock).not.toHaveBeenCalled();
    expect(completeReviewMock).not.toHaveBeenCalled();
  });

  it("resolves quickly even when the AI provider factory would hang — proving it's never awaited from this path", async () => {
    // If handlePullRequestEvent ever reached the AI pipeline, this would
    // make the provider construction itself hang forever, and the test
    // would time out. It doesn't, because that code path is unreachable
    // from the webhook handler now.
    getAIProviderMock.mockImplementation(() => new Promise(() => {}));

    const startedAt = Date.now();
    await handlePullRequestEvent(
      webhookBody({ action: "synchronize", headSha: "sha-1", createdAt: "2026-09-10T08:15:00Z" }),
    );
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });

  it("durably enqueues the review via findOrCreatePendingReview before returning — independent of the request's own lifecycle", async () => {
    // A fake in-memory "reviews table" shared between the enqueue call and
    // a later, independent claim call, standing in for "still there after
    // the HTTP response has already gone out, and after this process
    // could have restarted."
    const queue: Array<{ id: string; pullRequestId: string }> = [];
    findOrCreatePendingReviewMock.mockImplementation(async (pullRequestId: string) => {
      const id = `review-${queue.length + 1}`;
      queue.push({ id, pullRequestId });
      return { id, alreadyExisted: false };
    });

    await handlePullRequestEvent(
      webhookBody({ action: "opened", headSha: "sha-1", createdAt: "2026-09-10T08:15:00Z" }),
    );

    expect(queue).toHaveLength(1);
    // A later, unrelated call (standing in for the worker after a restart)
    // can still see the queued row — it isn't held in the request's own
    // in-memory closure.
    expect(queue[0]).toMatchObject({ pullRequestId: "pr-row-1" });
  });
});

describe("processPendingReviews — worker", () => {
  it("runs the real ReviewOrchestrator against a claimed job and persists the result via completeReview", async () => {
    claimNextPendingReviewMock
      .mockResolvedValueOnce({
        id: "review-1",
        pullRequestId: "pr-1",
        diffTruncated: false,
        changedFilesTruncated: false,
      })
      .mockResolvedValueOnce(null);
    getPullRequestByIdMock.mockResolvedValue({
      title: "Add retry logic",
      sourceBranch: "feat/retry",
      targetBranch: "main",
      changedFiles: [],
      diffText: "",
    });

    const { processed } = await processPendingReviews();

    expect(processed).toBe(1);
    expect(getAIProviderMock).toHaveBeenCalledTimes(1);
    expect(getReleaseJudgePortMock).toHaveBeenCalledTimes(1);
    expect(completeReviewMock).toHaveBeenCalledTimes(1);

    const [reviewId, result] = completeReviewMock.mock.calls[0];
    expect(reviewId).toBe("review-1");
    // Proof the REAL orchestrator ran (not a stub): a well-formed
    // OrchestratorResult with all 5 specialists + judge represented.
    expect(result.status).toMatch(/^(complete|failed)$/);
    expect(result.reviewerRuns).toHaveLength(6);
    expect(failReviewMock).not.toHaveBeenCalled();
  });

  it("drains multiple queued jobs in one call", async () => {
    claimNextPendingReviewMock
      .mockResolvedValueOnce({ id: "review-1", pullRequestId: "pr-1", diffTruncated: false, changedFilesTruncated: false })
      .mockResolvedValueOnce({ id: "review-2", pullRequestId: "pr-2", diffTruncated: false, changedFilesTruncated: false })
      .mockResolvedValueOnce(null);
    getPullRequestByIdMock.mockResolvedValue({
      title: "PR",
      sourceBranch: "feat/x",
      targetBranch: "main",
      changedFiles: [],
      diffText: "",
    });

    const { processed } = await processPendingReviews();

    expect(processed).toBe(2);
    expect(completeReviewMock).toHaveBeenCalledTimes(2);
  });

  it("fails closed when the claimed review's pull_request row can't be found, instead of leaving it stuck", async () => {
    claimNextPendingReviewMock
      .mockResolvedValueOnce({
        id: "review-1",
        pullRequestId: "missing-pr",
        diffTruncated: false,
        changedFilesTruncated: false,
      })
      .mockResolvedValueOnce(null);
    getPullRequestByIdMock.mockResolvedValue(null);

    const { processed } = await processPendingReviews();

    expect(processed).toBe(1);
    expect(completeReviewMock).not.toHaveBeenCalled();
    expect(failReviewMock).toHaveBeenCalledTimes(1);
    expect(failReviewMock.mock.calls[0][0]).toBe("review-1");
  });

  it("does nothing when the queue is empty", async () => {
    claimNextPendingReviewMock.mockResolvedValueOnce(null);

    const { processed } = await processPendingReviews();

    expect(processed).toBe(0);
    expect(getAIProviderMock).not.toHaveBeenCalled();
  });
});

describe("newer PR head SHA is handled independently of an older, still-processing review", () => {
  it("enqueues a second review for a new head_sha without checking or being blocked by the first review's state", async () => {
    const enqueued: Array<{ pullRequestId: string; headSha: string }> = [];
    findOrCreatePendingReviewMock.mockImplementation(
      async (pullRequestId: string, headSha: string) => {
        enqueued.push({ pullRequestId, headSha });
        return { id: `review-for-${headSha}`, alreadyExisted: false };
      },
    );

    // First synchronize: enqueues review-for-sha-1, presumed still
    // 'running' in the worker at the moment the next commit lands.
    await handlePullRequestEvent(
      webhookBody({ action: "synchronize", headSha: "sha-1", createdAt: "2026-09-10T08:15:00Z" }),
    );
    // Second synchronize for a newer commit on the same PR — must enqueue
    // independently, not wait for or inspect the first review at all.
    await handlePullRequestEvent(
      webhookBody({ action: "synchronize", headSha: "sha-2", createdAt: "2026-09-10T08:15:00Z" }),
    );

    expect(enqueued).toEqual([
      { pullRequestId: "pr-row-1", headSha: "sha-1" },
      { pullRequestId: "pr-row-1", headSha: "sha-2" },
    ]);
  });
});
