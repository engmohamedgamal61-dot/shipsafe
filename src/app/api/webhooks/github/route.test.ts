import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Route-level tests for the two things that live only in this file, not
 * in `src/server/github/ingest.ts`: the delivery-id idempotency guard,
 * and the end-to-end "responds fast, 202, without waiting on anything
 * async" behavior a real GitHub delivery actually observes.
 */
const { handlePullRequestEventMock, recordWebhookDeliveryMock } = vi.hoisted(() => ({
  handlePullRequestEventMock: vi.fn().mockResolvedValue(undefined),
  recordWebhookDeliveryMock: vi.fn(),
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
  recordWebhookDelivery: recordWebhookDeliveryMock,
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
    recordWebhookDeliveryMock.mockReset();
  });

  it("responds 202 quickly without waiting for anything beyond the fast enqueue path", async () => {
    recordWebhookDeliveryMock.mockResolvedValue({ isDuplicate: false });

    const startedAt = Date.now();
    const response = await POST(pullRequestWebhookRequest("delivery-1"));
    const elapsedMs = Date.now() - startedAt;

    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, queued: true });
    expect(elapsedMs).toBeLessThan(1000);
    expect(handlePullRequestEventMock).toHaveBeenCalledTimes(1);
  });

  it("does not re-run ingestion for a GitHub-retried delivery with the same delivery id", async () => {
    // Real behavior: the first insert into github_webhook_deliveries
    // succeeds, a second insert of the same delivery_id is a unique
    // violation — recordWebhookDelivery reports that as isDuplicate.
    recordWebhookDeliveryMock
      .mockResolvedValueOnce({ isDuplicate: false })
      .mockResolvedValueOnce({ isDuplicate: true });

    const first = await POST(pullRequestWebhookRequest("delivery-1"));
    const second = await POST(pullRequestWebhookRequest("delivery-1"));

    expect(first.status).toBe(202);
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody).toMatchObject({ ok: true, duplicate: true });

    // The expensive part (GitHub API calls, DB writes) only ever ran once.
    expect(handlePullRequestEventMock).toHaveBeenCalledTimes(1);
  });

  it("processes two different delivery ids for the same underlying event as independent, non-duplicate deliveries", async () => {
    recordWebhookDeliveryMock.mockResolvedValue({ isDuplicate: false });

    await POST(pullRequestWebhookRequest("delivery-1"));
    await POST(pullRequestWebhookRequest("delivery-2"));

    expect(handlePullRequestEventMock).toHaveBeenCalledTimes(2);
  });
});
