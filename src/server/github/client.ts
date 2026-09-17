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

  const response = await fetch(`${GITHUB_API_BASE}/app/installations/${installationId}`, {
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
  const response = await fetch(`${GITHUB_API_BASE}${path}`, {
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
