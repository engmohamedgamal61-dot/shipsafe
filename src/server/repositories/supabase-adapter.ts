import { createServerSupabaseClient } from "@/lib/supabase/server";
import type {
  ChangedFile,
  Finding,
  ProviderExecutionMetadata,
  PullRequest,
  Repository,
  Review,
  ReviewerKind,
  ReviewerRun,
  ReviewWithContext,
  RunStatus,
  Severity,
  Verdict,
} from "@/domain/types";
import { logger } from "@/lib/logger";
import type { ReviewRepository } from "./ports";

/**
 * Real persistence, active whenever `isSupabaseConfigured` is true. Reads
 * only — the write path (ingesting a real GitHub PR and running the
 * review engine against it) lands in Phase 2 alongside the GitHub App
 * integration; see docs/MVP-PLAN.md.
 *
 * These queries run against the user's own session (the anon key + their
 * JWT via `createServerSupabaseClient`), so Row Level Security is what
 * actually enforces "only this user's workspaces" — see
 * `supabase/migrations/0001_init.sql` and `supabase/tests/rls.test.sql`.
 * The `userId` parameter is not used to build an extra client-side filter
 * on top of that: a client-side filter can drift out of sync with the
 * policies and create a false sense of safety, whereas RLS is the one
 * enforcement point that authoritative writes also have to respect.
 */
export class SupabaseReviewRepository implements ReviewRepository {
  async listRepositoriesForUser(_userId: string): Promise<Repository[]> {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase
      .from("repositories")
      .select("*")
      .order("connected_at", { ascending: false });

    if (error) {
      logger.error("failed to list repositories", { error: error.message });
      return [];
    }

    return (data as unknown as SupabaseRepositoryRow[]).map(mapRepository);
  }

  async listReviewsForUser(_userId: string): Promise<ReviewWithContext[]> {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase
      .from("reviews")
      .select(
        "*, pull_requests!inner(*, repositories!inner(*)), reviewer_runs(*, findings(*))",
      );

    if (error) {
      logger.error("failed to list reviews", { error: error.message });
      return [];
    }

    return (data as unknown as SupabaseReviewRow[]).map(mapReviewWithContext);
  }

  async getReviewById(_userId: string, reviewId: string): Promise<ReviewWithContext | null> {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase
      .from("reviews")
      .select(
        "*, pull_requests!inner(*, repositories!inner(*)), reviewer_runs(*, findings(*))",
      )
      .eq("id", reviewId)
      .maybeSingle();

    if (error) {
      logger.error("failed to get review", { error: error.message, reviewId });
      return null;
    }
    if (!data) return null;

    return mapReviewWithContext(data as unknown as SupabaseReviewRow);
  }
}

// ---------------------------------------------------------------------------
// Row shapes + mappers (snake_case DB rows -> camelCase domain types)
// ---------------------------------------------------------------------------

interface SupabaseRepositoryRow {
  id: string;
  workspace_id: string;
  provider: string;
  external_repository_id: string | null;
  name: string;
  full_name: string;
  default_branch: string;
  connected_at: string;
}

interface SupabasePullRequestRow {
  id: string;
  repository_id: string;
  external_pull_request_id: string | null;
  number: number;
  title: string;
  source_branch: string;
  target_branch: string;
  author_login: string;
  changed_files: ChangedFile[];
  diff_text: string;
  head_sha: string;
  base_sha: string;
  opened_at: string;
  repositories: SupabaseRepositoryRow;
}

interface SupabaseFindingRow {
  id: string;
  reviewer_run_id: string;
  severity: string;
  title: string;
  description: string;
  file_path: string | null;
  line_start: number | null;
  line_end: number | null;
  category: string;
}

interface SupabaseReviewerRunRow {
  id: string;
  review_id: string;
  reviewer: string;
  status: string;
  summary: string | null;
  error_message: string | null;
  provider: string | null;
  model: string | null;
  request_id: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number | null;
  attempt: number;
  started_at: string | null;
  completed_at: string | null;
  findings: SupabaseFindingRow[];
}

interface SupabaseReviewRow {
  id: string;
  pull_request_id: string;
  status: string;
  verdict: string | null;
  summary: string | null;
  failure_reason: string | null;
  reviewed_head_sha: string;
  reviewed_base_sha: string | null;
  rule_version: string;
  prompt_version: string | null;
  started_at: string | null;
  completed_at: string | null;
  pull_requests: SupabasePullRequestRow;
  reviewer_runs: SupabaseReviewerRunRow[];
}

function mapRepository(row: SupabaseRepositoryRow): Repository {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    provider: row.provider as Repository["provider"],
    externalId: row.external_repository_id,
    name: row.name,
    fullName: row.full_name,
    defaultBranch: row.default_branch,
    connectedAt: row.connected_at,
  };
}

function mapPullRequest(row: SupabasePullRequestRow): PullRequest {
  return {
    id: row.id,
    repositoryId: row.repository_id,
    externalId: row.external_pull_request_id,
    number: row.number,
    title: row.title,
    sourceBranch: row.source_branch,
    targetBranch: row.target_branch,
    authorLogin: row.author_login,
    changedFiles: row.changed_files,
    diffText: row.diff_text,
    headSha: row.head_sha,
    baseSha: row.base_sha,
    openedAt: row.opened_at,
  };
}

function mapFinding(row: SupabaseFindingRow): Finding {
  return {
    id: row.id,
    reviewerRunId: row.reviewer_run_id,
    severity: row.severity as Severity,
    title: row.title,
    description: row.description,
    filePath: row.file_path,
    lineStart: row.line_start,
    lineEnd: row.line_end,
    category: row.category,
  };
}

function mapProviderMetadata(row: SupabaseReviewerRunRow): ProviderExecutionMetadata | null {
  if (!row.provider || !row.model) return null;
  return {
    provider: row.provider,
    model: row.model,
    requestId: row.request_id,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    latencyMs: row.latency_ms ?? 0,
    attempt: row.attempt,
  };
}

function mapReviewerRun(row: SupabaseReviewerRunRow): ReviewerRun {
  return {
    id: row.id,
    reviewId: row.review_id,
    reviewer: row.reviewer as ReviewerKind,
    status: row.status as RunStatus,
    summary: row.summary,
    errorMessage: row.error_message,
    providerMetadata: mapProviderMetadata(row),
    startedAt: row.started_at,
    completedAt: row.completed_at,
    findings: row.findings.map(mapFinding),
  };
}

function mapReviewWithContext(row: SupabaseReviewRow): ReviewWithContext {
  const review: Review = {
    id: row.id,
    pullRequestId: row.pull_request_id,
    status: row.status as RunStatus,
    verdict: row.verdict as Verdict | null,
    summary: row.summary,
    failureReason: row.failure_reason,
    reviewedHeadSha: row.reviewed_head_sha,
    reviewedBaseSha: row.reviewed_base_sha,
    ruleVersion: row.rule_version,
    promptVersion: row.prompt_version,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    reviewerRuns: row.reviewer_runs.map(mapReviewerRun),
  };

  return {
    ...review,
    pullRequest: mapPullRequest(row.pull_requests),
    repository: mapRepository(row.pull_requests.repositories),
  };
}
