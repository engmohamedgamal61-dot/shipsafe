import { createAppAuth } from "@octokit/auth-app";
import { env, githubAppPrivateKey } from "@/lib/env";
import {
  githubInstallationDetailsResponseSchema,
  githubInstallationRepositoriesResponseSchema,
  githubPullRequestFilesResponseSchema,
  type GithubAccount,
  type GithubPullRequestFile,
  type GithubRepositoryPayload,
} from "./types";

const GITHUB_API_BASE = "https://api.github.com";
const MAX_PAGES = 5; // 500 items at 100/page — generous for a self-hosted MVP without a real pagination UI yet.

/**
 * Bounded retry/backoff for transient GitHub API failures — audit fix
 * for v1 HIGH-2. Applies to every GitHub REST call in this module
 * (`githubRequest`, used by `fetchPullRequestDiff`/
 * `fetchPullRequestFiles`/`listInstallationRepositories`, and
 * `getInstallationDetails`'s own fetch).
 *
 * Retries: HTTP 429, any 5xx, and a thrown network error (`fetch`
 * throws for a connection failure — there is no request-level timeout
 * configured anywhere in this module today, so there is nothing
 * timeout-specific to add retry handling for beyond that). Never
 * retries any other 4xx — those are terminal (bad auth, not found,
 * validation failure) and retrying would only repeat the same failure.
 *
 * `MAX_ATTEMPTS` total attempts (the first try plus up to
 * `MAX_ATTEMPTS - 1` retries), exponential backoff from
 * `BASE_BACKOFF_MS`, capped at `MAX_BACKOFF_MS`, honoring a numeric or
 * HTTP-date `Retry-After` header when GitHub sends one and it implies a
 * longer wait than the exponential schedule would.
 */
const MAX_ATTEMPTS = 4;
const BASE_BACKOFF_MS = 300;
const MAX_BACKOFF_MS = 8_000;

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

/** `null` when there's no usable `Retry-After` (absent, or a value that already elapsed) — the exponential schedule applies instead. */
function retryAfterDelayMs(header: string | null): number | null {
  if (!header) return null;

  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_BACKOFF_MS);

  const dateMs = Date.parse(header);
  if (!Number.isNaN(dateMs)) {
    const delta = dateMs - Date.now();
    if (delta > 0) return Math.min(delta, MAX_BACKOFF_MS);
  }

  return null;
}

function backoffDelayMs(attempt: number, retryAfterHeader: string | null): number {
  const exponential = Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
  const fromRetryAfter = retryAfterDelayMs(retryAfterHeader);
  return fromRetryAfter !== null ? Math.max(exponential, fromRetryAfter) : exponential;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Drop-in replacement for `fetch` with bounded retry/backoff — always
 * returns a `Response` (never throws for an HTTP error status; the
 * caller's existing `!response.ok` handling is unchanged) except when
 * every attempt failed at the network level, in which case the last
 * network error is rethrown.
 */
async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      if (attempt === MAX_ATTEMPTS) throw error;
      await sleep(backoffDelayMs(attempt, null));
      continue;
    }

    if (response.ok || !isRetryableStatus(response.status) || attempt === MAX_ATTEMPTS) {
      return response;
    }

    await sleep(backoffDelayMs(attempt, response.headers.get("retry-after")));
  }

  // Unreachable — the loop above always returns or throws by its final iteration.
  throw new Error("fetchWithRetry: exhausted retries without a response");
}

/**
 * `@octokit/auth-app`'s returned auth function signs the App-level JWT
 * and exchanges it for an installation access token, caching the token
 * for its ~1 hour lifetime internally as long as the SAME auth instance
 * is reused — hence the module-level singleton rather than constructing
 * a fresh one per call.
 */
let cachedAuth: ReturnType<typeof createAppAuth> | null = null;

function getAppAuth() {
  if (!cachedAuth) {
    if (!env.GITHUB_APP_ID) {
      throw new Error("getAppAuth() called without GITHUB_APP_ID configured");
    }
    cachedAuth = createAppAuth({
      appId: env.GITHUB_APP_ID,
      privateKey: githubAppPrivateKey(),
    });
  }
  return cachedAuth;
}

export async function getInstallationToken(installationId: string): Promise<string> {
  const auth = getAppAuth();
  const { token } = await auth({ type: "installation", installationId });
  return token;
}

/** App-level details for one installation — who installed it, and what kind of account. */
export async function getInstallationDetails(
  installationId: string,
): Promise<{ id: number; account: GithubAccount }> {
  const auth = getAppAuth();
  const { token } = await auth({ type: "app" });

  const response = await fetchWithRetry(`${GITHUB_API_BASE}/app/installations/${installationId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    throw new Error(
      `GitHub API request failed: GET /app/installations/${installationId} -> ${response.status} ${await response.text()}`,
    );
  }

  const parsed = githubInstallationDetailsResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error(
      `GitHub API returned an unexpected shape for GET /app/installations/${installationId}: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

async function githubRequest(
  path: string,
  token: string,
  accept = "application/vnd.github+json",
): Promise<Response> {
  const response = await fetchWithRetry(`${GITHUB_API_BASE}${path}`, {
    headers: {
      Authorization: `token ${token}`,
      Accept: accept,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API request failed: GET ${path} -> ${response.status} ${body}`);
  }

  return response;
}

/** Unified diff text for a PR — the exact format `parseUnifiedDiff` expects. */
export async function fetchPullRequestDiff(
  owner: string,
  repo: string,
  number: number,
  token: string,
): Promise<string> {
  const response = await githubRequest(
    `/repos/${owner}/${repo}/pulls/${number}`,
    token,
    "application/vnd.github.v3.diff",
  );
  return response.text();
}

/** Per-file additions/deletions/status for a PR, paginated. */
export async function fetchPullRequestFiles(
  owner: string,
  repo: string,
  number: number,
  token: string,
): Promise<GithubPullRequestFile[]> {
  const files: GithubPullRequestFile[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const response = await githubRequest(
      `/repos/${owner}/${repo}/pulls/${number}/files?per_page=100&page=${page}`,
      token,
    );
    const parsed = githubPullRequestFilesResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new Error(
        `GitHub API returned an unexpected shape for GET /repos/${owner}/${repo}/pulls/${number}/files: ${parsed.error.message}`,
      );
    }
    files.push(...parsed.data);
    if (parsed.data.length < 100) break;
  }

  return files;
}

/** Every repository the given installation currently has access to. */
export async function listInstallationRepositories(
  token: string,
): Promise<GithubRepositoryPayload[]> {
  const repositories: GithubRepositoryPayload[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const response = await githubRequest(`/installation/repositories?per_page=100&page=${page}`, token);
    const parsed = githubInstallationRepositoriesResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new Error(
        `GitHub API returned an unexpected shape for GET /installation/repositories: ${parsed.error.message}`,
      );
    }
    repositories.push(...parsed.data.repositories);
    if (parsed.data.repositories.length < 100) break;
  }

  return repositories;
}
