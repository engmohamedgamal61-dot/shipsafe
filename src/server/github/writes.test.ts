import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `upsertPullRequest` talks to Supabase through `createServiceSupabaseClient()`
 * — mocked here so this stays a fast unit test of the payload it builds,
 * rather than an integration test needing a real database (that coverage
 * already exists at `supabase/tests/rls.test.sql`, run via `npm run test:rls`).
 */
const { upsertMock, singleMock } = vi.hoisted(() => ({
  upsertMock: vi.fn(),
  singleMock: vi.fn(),
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabaseClient: () => ({
    from: () => ({
      upsert: (payload: unknown, options: unknown) => {
        upsertMock(payload, options);
        return { select: () => ({ single: singleMock }) };
      },
    }),
  }),
}));

import { upsertPullRequest, type UpsertPullRequestInput } from "./writes";

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
