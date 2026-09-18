import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GithubPullRequestWebhookBody } from "./types";

/**
 * `handlePullRequestEvent` is the code path requirement #5 lives in:
 * "opened/reopened/synchronize events must preserve the original GitHub
 * PR creation timestamp." Everything it talks to outside the pure
 * request body (GitHub API client, Supabase writes, the AI provider) is
 * mocked here so this stays a fast, focused unit test of that specific
 * behavior rather than a full integration test.
 */
const { upsertPullRequestMock, findOrCreatePendingReviewMock, completeReviewMock } = vi.hoisted(() => ({
  upsertPullRequestMock: vi.fn().mockResolvedValue({ id: "pr-row-1" }),
  findOrCreatePendingReviewMock: vi.fn(),
  completeReviewMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./writes", () => ({
  upsertPullRequest: upsertPullRequestMock,
  findOrCreatePendingReview: findOrCreatePendingReviewMock,
  completeReview: completeReviewMock,
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

vi.mock("@/server/container", async () => {
  const { MockAIProvider } = await import("@/server/review-engine/providers/mock-provider");
  const { MockReleaseJudgeProvider } = await import("@/server/review-engine/providers/judge-provider");
  return {
    getAIProvider: () => new MockAIProvider(),
    getReleaseJudgePort: () => new MockReleaseJudgeProvider(),
  };
});

const { handlePullRequestEvent } = await import("./ingest");

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

describe("handlePullRequestEvent — created_at ingestion", () => {
  beforeEach(() => {
    upsertPullRequestMock.mockClear();
    findOrCreatePendingReviewMock.mockReset().mockResolvedValue({ id: "review-1", alreadyExisted: false });
    completeReviewMock.mockClear();
  });

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
