import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Every function here talks to Supabase through `createServiceSupabaseClient()`
 * — mocked so these stay fast unit tests of the payloads/query shapes each
 * function builds, rather than integration tests needing a real database
 * (that coverage already exists at `supabase/tests/rls.test.sql`, run via
 * `npm run test:rls`).
 */
const { upsertMock, singleMock, fromMock } = vi.hoisted(() => ({
  upsertMock: vi.fn(),
  singleMock: vi.fn(),
  fromMock: vi.fn(),
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabaseClient: () => ({ from: fromMock }),
}));

import {
  claimNextPendingReview,
  failReview,
  recordWebhookDelivery,
  upsertPullRequest,
  type UpsertPullRequestInput,
} from "./writes";

function input(overrides: Partial<UpsertPullRequestInput> = {}): UpsertPullRequestInput {
  return {
    repositoryId: "repo-1",
    externalId: "999",
    number: 42,
    title: "Add feature",
    sourceBranch: "feat/x",
    targetBranch: "main",
    authorLogin: "octocat",
    changedFiles: [],
    diffText: "",
    headSha: "abc123",
    baseSha: "def456",
    openedAt: "2026-09-10T08:15:00Z",
    ...overrides,
  };
}

describe("upsertPullRequest — opened_at persistence", () => {
  beforeEach(() => {
    upsertMock.mockClear();
    singleMock.mockReset().mockResolvedValue({ data: { id: "pr-row-1" }, error: null });
    fromMock.mockReset().mockImplementation(() => ({
      upsert: (payload: unknown, options: unknown) => {
        upsertMock(payload, options);
        return { select: () => ({ single: singleMock }) };
      },
    }));
  });

  it("sends the real GitHub PR creation time as opened_at, not a ShipSafe-generated timestamp", async () => {
    await upsertPullRequest(input({ openedAt: "2026-09-10T08:15:00Z" }));

    expect(upsertMock).toHaveBeenCalledTimes(1);
    const [payload] = upsertMock.mock.calls[0];
    expect(payload).toMatchObject({ opened_at: "2026-09-10T08:15:00Z" });
  });

  it("preserves the original creation time across a simulated opened -> synchronize sequence", async () => {
    const openedAt = "2026-09-10T08:15:00Z";

    // "opened" delivery — first insert.
    await upsertPullRequest(input({ openedAt, headSha: "sha-1" }));
    // "synchronize" delivery for a later commit — same PR, same created_at
    // (GitHub never changes a PR's created_at), different head_sha.
    await upsertPullRequest(input({ openedAt, headSha: "sha-2" }));

    expect(upsertMock).toHaveBeenCalledTimes(2);
    const firstPayload = upsertMock.mock.calls[0][0] as Record<string, unknown>;
    const secondPayload = upsertMock.mock.calls[1][0] as Record<string, unknown>;

    expect(firstPayload.opened_at).toBe(openedAt);
    expect(secondPayload.opened_at).toBe(openedAt);
    expect(secondPayload.head_sha).toBe("sha-2");
  });
});

describe("recordWebhookDelivery — GitHub delivery-id idempotency", () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it("returns isDuplicate:false the first time a delivery id is seen", async () => {
    fromMock.mockReturnValue({ insert: () => Promise.resolve({ error: null }) });

    const result = await recordWebhookDelivery("delivery-1", "pull_request");

    expect(result).toEqual({ isDuplicate: false });
  });

  it("returns isDuplicate:true when GitHub retries the same delivery id (unique violation)", async () => {
    fromMock.mockReturnValue({
      insert: () => Promise.resolve({ error: { code: "23505", message: "duplicate key value" } }),
    });

    const result = await recordWebhookDelivery("delivery-1", "pull_request");

    expect(result).toEqual({ isDuplicate: true });
  });

  it("throws on a non-conflict database error instead of silently treating it as a duplicate", async () => {
    fromMock.mockReturnValue({
      insert: () => Promise.resolve({ error: { code: "500", message: "connection reset" } }),
    });

    await expect(recordWebhookDelivery("delivery-1", "pull_request")).rejects.toThrow(/connection reset/);
  });
});

describe("failReview — fail-closed on a worker crash", () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it("sets status failed and verdict DO_NOT_APPROVE with the given reason", async () => {
    const updateMock = vi.fn().mockReturnValue({ eq: () => Promise.resolve({ error: null }) });
    fromMock.mockReturnValue({ update: updateMock });

    await failReview("review-1", "worker crashed mid-processing");

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        verdict: "DO_NOT_APPROVE",
        failure_reason: "worker crashed mid-processing",
      }),
    );
  });

  it("throws if the update itself fails", async () => {
    fromMock.mockReturnValue({ update: () => ({ eq: () => Promise.resolve({ error: { message: "db down" } }) }) });

    await expect(failReview("review-1", "reason")).rejects.toThrow(/db down/);
  });
});

/** A minimal chainable + thenable fake matching the subset of the PostgREST query builder `claimNextPendingReview` uses. */
function chain(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  const passthrough = vi.fn(() => builder);
  builder.select = passthrough;
  builder.or = vi.fn(() => builder);
  builder.order = passthrough;
  builder.limit = passthrough;
  builder.eq = passthrough;
  builder.update = passthrough;
  builder.maybeSingle = vi.fn(() => Promise.resolve(result));
  builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder as {
    select: ReturnType<typeof vi.fn>;
    or: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise<unknown>;
  };
}

describe("claimNextPendingReview — atomic queue claim", () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it("returns null when there are no eligible (pending or stale-running) rows", async () => {
    fromMock.mockReturnValueOnce(chain({ data: [], error: null }));

    const claimed = await claimNextPendingReview();

    expect(claimed).toBeNull();
  });

  it("claims the first candidate when the CAS update succeeds", async () => {
    fromMock.mockReturnValueOnce(chain({ data: [{ id: "review-1" }], error: null }));
    fromMock.mockReturnValueOnce(
      chain({
        data: { id: "review-1", pull_request_id: "pr-1", diff_truncated: false, changed_files_truncated: true },
        error: null,
      }),
    );

    const claimed = await claimNextPendingReview();

    expect(claimed).toEqual({
      id: "review-1",
      pullRequestId: "pr-1",
      diffTruncated: false,
      changedFilesTruncated: true,
    });
  });

  it("falls through to the next candidate when the first one loses the claim race", async () => {
    fromMock.mockReturnValueOnce(
      chain({ data: [{ id: "review-1" }, { id: "review-2" }], error: null }),
    );
    // First candidate: another worker already claimed it — CAS matches nothing.
    fromMock.mockReturnValueOnce(chain({ data: null, error: null }));
    // Second candidate: this worker wins.
    fromMock.mockReturnValueOnce(
      chain({
        data: { id: "review-2", pull_request_id: "pr-2", diff_truncated: false, changed_files_truncated: false },
        error: null,
      }),
    );

    const claimed = await claimNextPendingReview();

    expect(claimed?.id).toBe("review-2");
    expect(fromMock).toHaveBeenCalledTimes(3);
  });

  it("includes stale 'running' rows as claimable, not just 'pending' ones", async () => {
    const selectChain = chain({ data: [], error: null });
    fromMock.mockReturnValueOnce(selectChain);

    await claimNextPendingReview();

    expect(selectChain.or).toHaveBeenCalledWith(expect.stringContaining("status.eq.pending"));
    expect(selectChain.or).toHaveBeenCalledWith(expect.stringContaining("status.eq.running"));
    expect(selectChain.or).toHaveBeenCalledWith(expect.stringContaining("started_at.lt."));
  });
});
