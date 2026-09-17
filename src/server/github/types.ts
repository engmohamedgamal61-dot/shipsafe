import { z } from "zod";

/**
 * Zod schemas for the slices of GitHub's webhook/REST payloads ShipSafe
 * actually reads, and the TypeScript types derived from them. Deliberately
 * not the full `@octokit/webhooks-types` surface — narrower, and easier to
 * see exactly what this codebase depends on GitHub's API shape for.
 *
 * These schemas are the ONLY place external GitHub data (webhook bodies,
 * REST API responses) is trusted to have a given shape — see `client.ts`
 * and `src/app/api/webhooks/github/route.ts`, both of which `safeParse`
 * against these before touching the payload, rather than casting. GitHub
 * content is authored by whoever can push to/administer a connected repo,
 * not by this deployment, so it's untrusted input like any other.
 *
 * Object schemas intentionally don't `.strict()` — GitHub's real payloads
 * carry many fields ShipSafe doesn't use, and stripping unknown keys
 * rather than rejecting them is what lets this stay a narrow subset
 * instead of chasing GitHub's full schema.
 */

export const githubAccountSchema = z.object({
  login: z.string(),
  type: z.enum(["User", "Organization"]),
});
export type GithubAccount = z.infer<typeof githubAccountSchema>;

export const githubRepositoryPayloadSchema = z.object({
  id: z.number(),
  name: z.string(),
  full_name: z.string(),
  default_branch: z.string(),
  owner: githubAccountSchema,
});
export type GithubRepositoryPayload = z.infer<typeof githubRepositoryPayloadSchema>;

export const githubPullRequestPayloadSchema = z.object({
  id: z.number(),
  number: z.number(),
  title: z.string(),
  user: z.object({ login: z.string() }),
  head: z.object({ sha: z.string(), ref: z.string() }),
  base: z.object({ sha: z.string(), ref: z.string() }),
});
export type GithubPullRequestPayload = z.infer<typeof githubPullRequestPayloadSchema>;

export const githubInstallationPayloadSchema = z.object({
  id: z.number(),
  account: githubAccountSchema,
});
export type GithubInstallationPayload = z.infer<typeof githubInstallationPayloadSchema>;

/**
 * GitHub omits `patch` for a file when it's genuinely binary, or when a
 * text file's diff was too large to inline — either way, there is no
 * textual patch ShipSafe can review for that file. See
 * `src/server/github/pr-hardening.ts`.
 */
export const githubPullRequestFileSchema = z.object({
  filename: z.string(),
  status: z.string(),
  additions: z.number(),
  deletions: z.number(),
  patch: z.string().optional(),
});
export type GithubPullRequestFile = z.infer<typeof githubPullRequestFileSchema>;

export const githubInstallationWebhookBodySchema = z.object({
  action: z.string(),
  installation: githubInstallationPayloadSchema,
  repositories: z.array(githubRepositoryPayloadSchema).optional(),
});
export type GithubInstallationWebhookBody = z.infer<typeof githubInstallationWebhookBodySchema>;

export const githubInstallationRepositoriesWebhookBodySchema = z.object({
  action: z.enum(["added", "removed"]),
  installation: githubInstallationPayloadSchema,
  repositories_added: z.array(githubRepositoryPayloadSchema).optional(),
  repositories_removed: z.array(githubRepositoryPayloadSchema).optional(),
});
export type GithubInstallationRepositoriesWebhookBody = z.infer<
  typeof githubInstallationRepositoriesWebhookBodySchema
>;

export const githubPullRequestWebhookBodySchema = z.object({
  action: z.string(),
  installation: githubInstallationPayloadSchema.optional(),
  repository: githubRepositoryPayloadSchema,
  pull_request: githubPullRequestPayloadSchema,
});
export type GithubPullRequestWebhookBody = z.infer<typeof githubPullRequestWebhookBodySchema>;

// --- REST API response shapes (not webhook bodies) ---

/** GET /app/installations/:id */
export const githubInstallationDetailsResponseSchema = z.object({
  id: z.number(),
  account: githubAccountSchema,
});

/** GET /installation/repositories */
export const githubInstallationRepositoriesResponseSchema = z.object({
  repositories: z.array(githubRepositoryPayloadSchema),
});

/** GET /repos/:owner/:repo/pulls/:number/files */
export const githubPullRequestFilesResponseSchema = z.array(githubPullRequestFileSchema);
