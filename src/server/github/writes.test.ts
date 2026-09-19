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
  claimWebhookDelivery,
  failReview,
  markWebhookDeliveryCompleted,
  RepositoryWorkspaceConflictError,
  upsertPullRequest,
  upsertRepository,
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

/** A minimal chainable fake matching the subset of the PostgREST query builder `claimWebhookDelivery`/`markWebhookDeliveryCompleted` use. */
function insertOutcome(error: unknown) {
  return { insert: () => Promise.resolve({ error }) };
}

function selectDeliveryOutcome(data: { completed_at: string | null; received_at: string } | null) {
  return {
    select: () => ({
      eq: () => ({
        maybeSingle: () => Promise.resolve({ data, error: null }),
      }),
    }),
  };
}

function reclaimOutcome(data: { delivery_id: string } | null) {
  return {
    update: () => ({
      eq: () => ({
        eq: () => ({
          is: () => ({
            select: () => ({
              maybeSingle: () => Promise.resolve({ data, error: null }),
            }),
          }),
        }),
      }),
    }),
  };
}

function completeOutcome(error: unknown) {
  return { update: () => ({ eq: () => Promise.resolve({ error }) }) };
}

const RECENT = new Date().toISOString();
const STALE = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 min ago — past the 2-minute claim window

describe("claimWebhookDelivery / markWebhookDeliveryCompleted — GitHub delivery-id idempotency (audit fix HIGH-1)", () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it("1. a successful delivery is processed once: first insert succeeds -> 'claimed'", async () => {
    fromMock.mockReturnValueOnce(insertOutcome(null));

    const claim = await claimWebhookDelivery("delivery-1", "pull_request");

    expect(claim).toBe("claimed");
  });

  it("2. a duplicate of an already-completed delivery is ignored: insert conflicts, row is completed -> 'duplicate'", async () => {
    fromMock.mockReturnValueOnce(insertOutcome({ code: "23505", message: "duplicate key value" }));
    fromMock.mockReturnValueOnce(selectDeliveryOutcome({ completed_at: RECENT, received_at: RECENT }));

    const claim = await claimWebhookDelivery("delivery-1", "pull_request");

    expect(claim).toBe("duplicate");
  });

  it("3. a failed first attempt can be retried with the same delivery id once stale: insert conflicts, row never completed and is past the claim window -> reclaimed as 'claimed'", async () => {
    fromMock.mockReturnValueOnce(insertOutcome({ code: "23505", message: "duplicate key value" }));
    fromMock.mockReturnValueOnce(selectDeliveryOutcome({ completed_at: null, received_at: STALE }));
    fromMock.mockReturnValueOnce(reclaimOutcome({ delivery_id: "delivery-1" }));

    const claim = await claimWebhookDelivery("delivery-1", "pull_request");

    expect(claim).toBe("claimed");
  });

  it("4. after a retry succeeds and completes, a further duplicate delivery is ignored", async () => {
    // The reclaim from scenario 3.
    fromMock.mockReturnValueOnce(insertOutcome({ code: "23505", message: "duplicate key value" }));
    fromMock.mockReturnValueOnce(selectDeliveryOutcome({ completed_at: null, received_at: STALE }));
    fromMock.mockReturnValueOnce(reclaimOutcome({ delivery_id: "delivery-1" }));
    expect(await claimWebhookDelivery("delivery-1", "pull_request")).toBe("claimed");

    fromMock.mockReturnValueOnce(completeOutcome(null));
    await markWebhookDeliveryCompleted("delivery-1");

    // A later duplicate now finds a completed row.
    fromMock.mockReturnValueOnce(insertOutcome({ code: "23505", message: "duplicate key value" }));
    fromMock.mockReturnValueOnce(selectDeliveryOutcome({ completed_at: RECENT, received_at: STALE }));
    expect(await claimWebhookDelivery("delivery-1", "pull_request")).toBe("duplicate");
  });

  it("5. concurrent duplicate delivery: a second delivery racing the first (row exists, uncompleted, still within the claim window) is treated as in-progress, not reprocessed", async () => {
    // The second of two near-simultaneous deliveries loses the insert race
    // against the first (which is still actively processing, hence the
    // very recent received_at with no completed_at yet).
    fromMock.mockReturnValueOnce(insertOutcome({ code: "23505", message: "duplicate key value" }));
    fromMock.mockReturnValueOnce(selectDeliveryOutcome({ completed_at: null, received_at: RECENT }));

    const claim = await claimWebhookDelivery("delivery-1", "pull_request");

    expect(claim).toBe("in_progress");
  });

  it("also treats a lost reclaim race (another caller already reclaimed/completed it) as in-progress rather than double-processing", async () => {
    fromMock.mockReturnValueOnce(insertOutcome({ code: "23505", message: "duplicate key value" }));
    fromMock.mockReturnValueOnce(selectDeliveryOutcome({ completed_at: null, received_at: STALE }));
    fromMock.mockReturnValueOnce(reclaimOutcome(null)); // CAS matched nothing — someone else already reclaimed it.

    const claim = await claimWebhookDelivery("delivery-1", "pull_request");

    expect(claim).toBe("in_progress");
  });

  it("throws on a non-conflict database error instead of silently treating it as a duplicate", async () => {
    fromMock.mockReturnValueOnce(insertOutcome({ code: "500", message: "connection reset" }));

    await expect(claimWebhookDelivery("delivery-1", "pull_request")).rejects.toThrow(/connection reset/);
  });

  it("markWebhookDeliveryCompleted logs rather than throws when the update fails", async () => {
    fromMock.mockReturnValueOnce(completeOutcome({ message: "db down" }));

    await expect(markWebhookDeliveryCompleted("delivery-1")).resolves.toBeUndefined();
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

function repoLookupOutcome(data: { id: string; workspace_id: string; full_name: string } | null) {
  return {
    select: () => ({
      eq: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data, error: null }),
        }),
      }),
    }),
  };
}

function repoUpdateOutcome(result: { data: { id: string } | null; error: unknown }) {
  const updateMock = vi.fn();
  return {
    update: (payload: unknown) => {
      updateMock(payload);
      return { eq: () => ({ select: () => ({ single: () => Promise.resolve(result) }) }) };
    },
    updateMock,
  };
}

function repoInsertOutcome(result: { data: { id: string } | null; error: unknown }) {
  const insertMock = vi.fn();
  return {
    insert: (payload: unknown) => {
      insertMock(payload);
      return { select: () => ({ single: () => Promise.resolve(result) }) };
    },
    insertMock,
  };
}

function repoRef(overrides: Partial<{ id: number; name: string; full_name: string; default_branch: string }> = {}) {
  return { id: 555, name: "payments-service", full_name: "acme/payments-service", ...overrides };
}

describe("upsertRepository — cross-tenant reparenting protection (audit fix HIGH-3)", () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it("1. same-workspace resync succeeds", async () => {
    fromMock.mockReturnValueOnce(repoLookupOutcome({ id: "repo-1", workspace_id: "ws-a", full_name: "acme/payments-service" }));
    const updateOutcome = repoUpdateOutcome({ data: { id: "repo-1" }, error: null });
    fromMock.mockReturnValueOnce(updateOutcome);

    const result = await upsertRepository(repoRef(), "ws-a", "install-row-1");

    expect(result).toEqual({ id: "repo-1" });
  });

  it("2. metadata updates within the same workspace succeed, and the update payload never includes workspace_id", async () => {
    fromMock.mockReturnValueOnce(repoLookupOutcome({ id: "repo-1", workspace_id: "ws-a", full_name: "acme/old-name" }));
    const updateOutcome = repoUpdateOutcome({ data: { id: "repo-1" }, error: null });
    fromMock.mockReturnValueOnce(updateOutcome);

    await upsertRepository(repoRef({ full_name: "acme/payments-service", default_branch: "develop" }), "ws-a", "install-row-1");

    expect(updateOutcome.updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ full_name: "acme/payments-service", default_branch: "develop", github_installation_id: "install-row-1" }),
    );
    const [payload] = updateOutcome.updateMock.mock.calls[0];
    expect(payload).not.toHaveProperty("workspace_id");
  });

  it("3. a different workspace cannot claim an existing external_repository_id: throws RepositoryWorkspaceConflictError", async () => {
    fromMock.mockReturnValueOnce(repoLookupOutcome({ id: "repo-1", workspace_id: "ws-a", full_name: "acme/payments-service" }));

    await expect(upsertRepository(repoRef(), "ws-b", "install-row-2")).rejects.toThrow(RepositoryWorkspaceConflictError);
  });

  it("4. existing review/history ownership remains unchanged: a rejected cross-workspace claim performs zero writes", async () => {
    fromMock.mockReturnValueOnce(repoLookupOutcome({ id: "repo-1", workspace_id: "ws-a", full_name: "acme/payments-service" }));

    await expect(upsertRepository(repoRef(), "ws-b", "install-row-2")).rejects.toThrow();

    // Only the read-only lookup ran — no update/insert call was ever made.
    expect(fromMock).toHaveBeenCalledTimes(1);
  });

  it("creates a fresh row for a genuinely new external_repository_id", async () => {
    fromMock.mockReturnValueOnce(repoLookupOutcome(null));
    const insertOutcome = repoInsertOutcome({ data: { id: "repo-new" }, error: null });
    fromMock.mockReturnValueOnce(insertOutcome);

    const result = await upsertRepository(repoRef(), "ws-a", "install-row-1");

    expect(result).toEqual({ id: "repo-new" });
    expect(insertOutcome.insertMock).toHaveBeenCalledWith(expect.objectContaining({ workspace_id: "ws-a" }));
  });

  it("a concurrent insert race for the same new repo resolves via recursion: the loser re-checks and rejects if the winner belongs to a different workspace", async () => {
    // This call's own insert loses the race.
    fromMock.mockReturnValueOnce(repoLookupOutcome(null));
    fromMock.mockReturnValueOnce(repoInsertOutcome({ data: null, error: { code: "23505", message: "duplicate key" } }));
    // Recursive re-check: the winner's row belongs to a different workspace.
    fromMock.mockReturnValueOnce(repoLookupOutcome({ id: "repo-1", workspace_id: "ws-a", full_name: "acme/payments-service" }));

    await expect(upsertRepository(repoRef(), "ws-b", "install-row-2")).rejects.toThrow(RepositoryWorkspaceConflictError);
  });

  it("a concurrent insert race for the same new repo resolves via recursion: the loser re-checks and succeeds if the winner used the same workspace", async () => {
    fromMock.mockReturnValueOnce(repoLookupOutcome(null));
    fromMock.mockReturnValueOnce(repoInsertOutcome({ data: null, error: { code: "23505", message: "duplicate key" } }));
    fromMock.mockReturnValueOnce(repoLookupOutcome({ id: "repo-1", workspace_id: "ws-a", full_name: "acme/payments-service" }));
    fromMock.mockReturnValueOnce(repoUpdateOutcome({ data: { id: "repo-1" }, error: null }));

    const result = await upsertRepository(repoRef(), "ws-a", "install-row-1");

    expect(result).toEqual({ id: "repo-1" });
  });
});
