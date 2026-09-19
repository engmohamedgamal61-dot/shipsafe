import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Route-level tests for the two things that live only in this file, not
 * in `src/server/github/ingest.ts`: the delivery-id idempotency guard,
 * and the end-to-end "responds fast, 202, without waiting on anything
 * async" behavior a real GitHub delivery actually observes.
 */
const { handlePullRequestEventMock, claimWebhookDeliveryMock, markWebhookDeliveryCompletedMock } = vi.hoisted(() => ({
  handlePullRequestEventMock: vi.fn().mockResolvedValue(undefined),
  claimWebhookDeliveryMock: vi.fn(),
  markWebhookDeliveryCompletedMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/env", () => ({
  env: { GITHUB_WEBHOOK_SECRET: "test-secret" },
  isGitHubConfigured: true,
}));

vi.mock("@/server/github/webhook-signature", () => ({
  // Signature verification has its own dedicated tests
  // (webhook-signature.test.ts) — always-true here keeps this file
  // focused on idempotency/response-time behavior.
  verifyGithubSignature: () => true,
}));

vi.mock("@/server/github/ingest", () => ({
  handleInstallationEvent: vi.fn(),
  handleInstallationRepositoriesEvent: vi.fn(),
  handlePullRequestEvent: handlePullRequestEventMock,
}));

vi.mock("@/server/github/writes", () => ({
  claimWebhookDelivery: claimWebhookDeliveryMock,
  markWebhookDeliveryCompleted: markWebhookDeliveryCompletedMock,
}));

const { POST } = await import("./route");

function pullRequestWebhookRequest(deliveryId: string) {
  const body = {
    action: "synchronize",
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
      head: { sha: "sha-1", ref: "feat/retry" },
      base: { sha: "base-sha", ref: "main" },
      created_at: "2026-09-10T08:15:00Z",
    },
  };

  return new Request("http://localhost/api/webhooks/github", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": "sha256=irrelevant-because-verify-is-mocked",
      "x-github-event": "pull_request",
      "x-github-delivery": deliveryId,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/webhooks/github — pull_request handling", () => {
  beforeEach(() => {
    handlePullRequestEventMock.mockClear();
    handlePullRequestEventMock.mockResolvedValue(undefined);
    claimWebhookDeliveryMock.mockReset();
    markWebhookDeliveryCompletedMock.mockClear();
    markWebhookDeliveryCompletedMock.mockResolvedValue(undefined);
  });

  it("responds 202 quickly without waiting for anything beyond the fast enqueue path, then marks the delivery completed", async () => {
    claimWebhookDeliveryMock.mockResolvedValue("claimed");

    const startedAt = Date.now();
    const response = await POST(pullRequestWebhookRequest("delivery-1"));
    const elapsedMs = Date.now() - startedAt;

    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, queued: true });
    expect(elapsedMs).toBeLessThan(1000);
    expect(handlePullRequestEventMock).toHaveBeenCalledTimes(1);
    expect(markWebhookDeliveryCompletedMock).toHaveBeenCalledWith("delivery-1");
  });

  it("does not re-run ingestion for a GitHub-retried delivery already completed successfully", async () => {
    claimWebhookDeliveryMock.mockResolvedValueOnce("claimed").mockResolvedValueOnce("duplicate");

    const first = await POST(pullRequestWebhookRequest("delivery-1"));
    const second = await POST(pullRequestWebhookRequest("delivery-1"));

    expect(first.status).toBe(202);
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody).toMatchObject({ ok: true, duplicate: true });

    // The expensive part (GitHub API calls, DB writes) only ever ran once.
    expect(handlePullRequestEventMock).toHaveBeenCalledTimes(1);
  });

  it("ignores a concurrent/in-progress duplicate delivery without reprocessing", async () => {
    claimWebhookDeliveryMock.mockResolvedValueOnce("in_progress");

    const response = await POST(pullRequestWebhookRequest("delivery-1"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, duplicate: true });
    expect(handlePullRequestEventMock).not.toHaveBeenCalled();
  });

  it("audit fix HIGH-1: a failed first attempt never marks the delivery completed, so it stays retryable under the same delivery id", async () => {
    claimWebhookDeliveryMock.mockResolvedValue("claimed");
    handlePullRequestEventMock.mockRejectedValueOnce(new Error("transient GitHub API 5xx"));

    const response = await POST(pullRequestWebhookRequest("delivery-1"));

    expect(response.status).toBe(500);
    expect(markWebhookDeliveryCompletedMock).not.toHaveBeenCalled();
  });

  it("audit fix HIGH-1: a retry that reaches 'claimed' again (the prior attempt never completed) reprocesses and then completes", async () => {
    claimWebhookDeliveryMock.mockResolvedValueOnce("claimed");
    handlePullRequestEventMock.mockRejectedValueOnce(new Error("transient failure"));
    const failedAttempt = await POST(pullRequestWebhookRequest("delivery-1"));
    expect(failedAttempt.status).toBe(500);

    claimWebhookDeliveryMock.mockResolvedValueOnce("claimed");
    const retry = await POST(pullRequestWebhookRequest("delivery-1"));

    expect(retry.status).toBe(202);
    expect(handlePullRequestEventMock).toHaveBeenCalledTimes(2);
    expect(markWebhookDeliveryCompletedMock).toHaveBeenCalledTimes(1);
    expect(markWebhookDeliveryCompletedMock).toHaveBeenCalledWith("delivery-1");
  });

  it("processes two different delivery ids for the same underlying event as independent, non-duplicate deliveries", async () => {
    claimWebhookDeliveryMock.mockResolvedValue("claimed");

    await POST(pullRequestWebhookRequest("delivery-1"));
    await POST(pullRequestWebhookRequest("delivery-2"));

    expect(handlePullRequestEventMock).toHaveBeenCalledTimes(2);
  });
});
