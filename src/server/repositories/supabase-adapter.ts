import { createServerSupabaseClient } from "@/lib/supabase/server";
import type {
  Finding,
  ProviderExecutionMetadata,
  PullRequest,
  Repository,
  Review,
  ReviewerRun,
  ReviewWithContext,
} from "@/domain/types";
import { logger } from "@/lib/logger";
import {
  repositoryRowSchema,
  reviewRowSchema,
  type SupabaseFindingRow,
  type SupabasePullRequestRow,
  type SupabaseRepositoryRow,
  type SupabaseReviewerRunRow,
  type SupabaseReviewRow,
} from "@/lib/supabase/row-schemas";
import { z } from "zod";
import type { ReviewRepository } from "./ports";

/**
 * Real persistence, active whenever `isSupabaseConfigured` is true. Reads
 * only — the write path (ingesting a real GitHub PR and running the
 * review engine against it) is `src/server/github/writes.ts`, which uses
 * the service-role client instead of this one.
 *
 * These queries run against the user's own session (the anon key + their
 * JWT via `createServerSupabaseClient`), so Row Level Security is what
 * actually enforces "only this user's workspaces" — see
 * `supabase/migrations/0001_init.sql` and `supabase/tests/rls.test.sql`.
 * The `userId` parameter is not used to build an extra client-side filter
 * on top of that: a client-side filter can drift out of sync with the
 * policies and create a false sense of safety, whereas RLS is the one
 * enforcement point that authoritative writes also have to respect.
 *
 * Every row read here is `safeParse`d against the schemas in
 * `src/lib/supabase/row-schemas.ts` before it's trusted — see that file
 * for why. A validation failure logs and fails closed (empty
 * list/`null`), the same as a query error, rather than handing malformed
 * data to the mappers below.
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

    const parsed = z.array(repositoryRowSchema).safeParse(data);
    if (!parsed.success) {
      logger.error("received malformed repository rows from supabase", {
        issues: parsed.error.issues,
      });
      return [];
    }

    return parsed.data.map(mapRepository);
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

    const parsed = z.array(reviewRowSchema).safeParse(data);
    if (!parsed.success) {
      logger.error("received malformed review rows from supabase", {
        issues: parsed.error.issues,
      });
      return [];
    }

    return parsed.data.map(mapReviewWithContext);
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

    const parsed = reviewRowSchema.safeParse(data);
    if (!parsed.success) {
      logger.error("received a malformed review row from supabase", {
        reviewId,
        issues: parsed.error.issues,
      });
      return null;
    }

    return mapReviewWithContext(parsed.data);
  }
}

// ---------------------------------------------------------------------------
// Mappers (validated snake_case DB rows -> camelCase domain types)
// ---------------------------------------------------------------------------

function mapRepository(row: SupabaseRepositoryRow): Repository {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    provider: row.provider,
    externalId: row.external_repository_id,
    githubInstallationId: row.github_installation_id,
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
    severity: row.severity,
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
    reviewer: row.reviewer,
    status: row.status,
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
    status: row.status,
    verdict: row.verdict,
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
