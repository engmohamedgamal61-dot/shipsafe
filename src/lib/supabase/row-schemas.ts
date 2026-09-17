import { z } from "zod";

/**
 * Zod schemas for every row shape `SupabaseReviewRepository` reads back
 * from Postgres (see `src/server/repositories/supabase-adapter.ts`), and
 * the TypeScript types derived from them.
 *
 * A hand-written `Database` type (`src/lib/supabase/types.ts`) only
 * checks queries at compile time — it says nothing about what actually
 * comes back over the wire. Real data can still be malformed: RLS lets
 * this go through the user's own session (not the service role, which is
 * what `src/server/github/writes.ts` — the only writer — always uses),
 * but a schema drift between a migration and this hand-written mirror, or
 * a future direct SQL write, would otherwise reach the UI as silently
 * wrong `as`-cast data instead of a clear, logged failure. `safeParse`
 * against these schemas is what makes that fail loudly instead.
 */

const changedFileRowSchema = z.object({
  path: z.string(),
  status: z.enum(["added", "modified", "removed", "renamed"]),
  additions: z.number(),
  deletions: z.number(),
  binary: z.boolean().optional(),
});

export const repositoryRowSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  provider: z.enum(["github", "demo"]),
  external_repository_id: z.string().nullable(),
  github_installation_id: z.string().nullable(),
  name: z.string(),
  full_name: z.string(),
  default_branch: z.string(),
  connected_at: z.string(),
});
export type SupabaseRepositoryRow = z.infer<typeof repositoryRowSchema>;

export const pullRequestRowSchema = z.object({
  id: z.string(),
  repository_id: z.string(),
  external_pull_request_id: z.string().nullable(),
  number: z.number(),
  title: z.string(),
  source_branch: z.string(),
  target_branch: z.string(),
  author_login: z.string(),
  changed_files: z.array(changedFileRowSchema),
  diff_text: z.string(),
  head_sha: z.string(),
  base_sha: z.string(),
  opened_at: z.string(),
  repositories: repositoryRowSchema,
});
export type SupabasePullRequestRow = z.infer<typeof pullRequestRowSchema>;

export const findingRowSchema = z.object({
  id: z.string(),
  reviewer_run_id: z.string(),
  severity: z.enum(["P0", "P1", "P2", "NIT"]),
  title: z.string(),
  description: z.string(),
  file_path: z.string().nullable(),
  line_start: z.number().nullable(),
  line_end: z.number().nullable(),
  category: z.string(),
});
export type SupabaseFindingRow = z.infer<typeof findingRowSchema>;

export const reviewerRunRowSchema = z.object({
  id: z.string(),
  review_id: z.string(),
  reviewer: z.enum(["code", "security", "architecture", "database", "test", "judge"]),
  status: z.enum(["pending", "running", "complete", "failed"]),
  summary: z.string().nullable(),
  error_message: z.string().nullable(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  request_id: z.string().nullable(),
  input_tokens: z.number().nullable(),
  output_tokens: z.number().nullable(),
  latency_ms: z.number().nullable(),
  attempt: z.number(),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  findings: z.array(findingRowSchema),
});
export type SupabaseReviewerRunRow = z.infer<typeof reviewerRunRowSchema>;

export const reviewRowSchema = z.object({
  id: z.string(),
  pull_request_id: z.string(),
  status: z.enum(["pending", "running", "complete", "failed"]),
  verdict: z.enum(["APPROVE", "APPROVE_WITH_MINOR_FIXES", "DO_NOT_APPROVE"]).nullable(),
  summary: z.string().nullable(),
  failure_reason: z.string().nullable(),
  reviewed_head_sha: z.string(),
  reviewed_base_sha: z.string().nullable(),
  rule_version: z.string(),
  prompt_version: z.string().nullable(),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  pull_requests: pullRequestRowSchema,
  reviewer_runs: z.array(reviewerRunRowSchema),
});
export type SupabaseReviewRow = z.infer<typeof reviewRowSchema>;
