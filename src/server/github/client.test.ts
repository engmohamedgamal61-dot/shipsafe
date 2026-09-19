import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Retry/backoff tests for `fetchWithRetry` — audit fix for v1 HIGH-2 —
 * exercised through the exported functions that use it
 * (`fetchPullRequestFiles`, `fetchPullRequestDiff`,
 * `listInstallationRepositories`, `getInstallationDetails`). Uses fake
 * timers so the exponential backoff delays never actually elapse in
 * real wall-clock time.
 */

vi.mock("@/lib/env", () => ({
  env: { GITHUB_APP_ID: "12345" },
  githubAppPrivateKey: () => "fake-private-key",
}));

const authMock = vi.fn().mockResolvedValue({ token: "app-level-jwt" });
vi.mock("@octokit/auth-app", () => ({
  createAppAuth: () => authMock,
}));

const { fetchPullRequestFiles, fetchPullRequestDiff, listInstallationRepositories, getInstallationDetails } = await import("./client");

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function textResponse(status: number, body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers });
}

const VALID_FILES_PAGE = [{ filename: "a.ts", status: "modified", additions: 1, deletions: 0, patch: "@@ -1 +1 @@\n-a\n+b" }];
const VALID_REPOS_PAGE = { repositories: [{ id: 1, name: "r", full_name: "acme/r", default_branch: "main", owner: { login: "acme", type: "Organization" } }] };
const VALID_INSTALLATION_DETAILS = { id: 1, account: { login: "acme", type: "Organization" } };

describe("GitHub client retry/backoff (audit fix HIGH-2)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("429 then success: retries once and returns the successful result", async () => {
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(jsonResponse(429, { message: "rate limited" }))
      .mockResolvedValueOnce(jsonResponse(200, VALID_FILES_PAGE));

    const promise = fetchPullRequestFiles("acme", "repo", 1, "token");
    await vi.advanceTimersByTimeAsync(10_000);
    const files = await promise;

    expect(files).toHaveLength(1);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("500 then success: retries once and returns the successful result", async () => {
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(textResponse(500, "internal error"))
      .mockResolvedValueOnce(textResponse(200, "diff --git a/x b/x\n"));

    const promise = fetchPullRequestDiff("acme", "repo", 1, "token");
    await vi.advanceTimersByTimeAsync(10_000);
    const diff = await promise;

    expect(diff).toContain("diff --git");
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("repeated 5xx exhausts retries: throws after the bounded number of attempts, never retrying forever", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(textResponse(503, "service unavailable"));

    const promise = fetchPullRequestDiff("acme", "repo", 1, "token");
    promise.catch(() => {}); // avoid an unhandled-rejection warning while we advance timers below
    await vi.advanceTimersByTimeAsync(60_000);

    await expect(promise).rejects.toThrow(/503/);
    // Bounded: a fixed, small number of attempts, not "keeps trying forever".
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(1);
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeLessThanOrEqual(4);
  });

  it("404 does not retry: fails immediately on a single attempt", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(textResponse(404, "not found"));

    const promise = fetchPullRequestDiff("acme", "repo", 1, "token");
    await expect(promise).rejects.toThrow(/404/);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("401/other terminal 4xx errors do not retry either", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(textResponse(401, "bad credentials"));

    const promise = listInstallationRepositories("token");
    await expect(promise).rejects.toThrow(/401/);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("respects a numeric Retry-After header, waiting at least that long before the next attempt", async () => {
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(jsonResponse(429, { message: "rate limited" }, { "retry-after": "5" }))
      .mockResolvedValueOnce(jsonResponse(200, VALID_REPOS_PAGE));

    const promise = listInstallationRepositories("token");

    // Advancing less than the requested 5s must NOT have triggered the retry yet.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3_500);
    const repos = await promise;

    expect(repos).toHaveLength(1);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("a network-level failure (fetch throws) is retried like a transient error", async () => {
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(jsonResponse(200, VALID_FILES_PAGE));

    const promise = fetchPullRequestFiles("acme", "repo", 1, "token");
    await vi.advanceTimersByTimeAsync(10_000);
    const files = await promise;

    expect(files).toHaveLength(1);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("getInstallationDetails also retries a transient 5xx before succeeding", async () => {
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(textResponse(502, "bad gateway"))
      .mockResolvedValueOnce(jsonResponse(200, VALID_INSTALLATION_DETAILS));

    const promise = getInstallationDetails("999");
    await vi.advanceTimersByTimeAsync(10_000);
    const details = await promise;

    expect(details).toEqual(VALID_INSTALLATION_DETAILS);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("getInstallationDetails does not retry a 404 (unknown installation)", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(textResponse(404, "not found"));

    await expect(getInstallationDetails("999")).rejects.toThrow(/404/);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("preserves response-shape validation: a 200 with an unexpected body still throws", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(200, { unexpected: "shape" }));

    await expect(listInstallationRepositories("token")).rejects.toThrow(/unexpected shape/);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
