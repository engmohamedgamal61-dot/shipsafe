import { randomUUID } from "node:crypto";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { attachReviewIds, type OrchestratorResult } from "@/server/review-engine/orchestrator";
import type { ChangedFile } from "@/domain/types";
import type { GithubAccount, GithubRepositoryRef } from "./types";

const UNIQUE_VIOLATION = "23505";

/**
 * All writes here go through the service-role client — these are the
 * four "authoritative" tables plus `github_installations`, none of which
 * have an INSERT/UPDATE policy for the `authenticated` role. See
 * docs/ARCHITECTURE.md § Server-Authoritative Writes & RLS. This module
 * is the ONLY place in the GitHub integration that writes to the
 * database; `ingest.ts` calls these functions but never talks to
 * Supabase directly.
 */

export async function upsertInstallation(
  installationId: string,
  account: GithubAccount,
  workspaceId: string | null,
): Promise<{ id: string; workspaceId: string | null }> {
  const supabase = createServiceSupabaseClient();

  const { data: existing } = await supabase
    .from("github_installations")
    .select("id, workspace_id")
    .eq("installation_id", installationId)
    .maybeSingle();

  if (existing) {
    // Never downgrade an already-linked installation back to unlinked —
    // only set workspace_id when we actually have one to set (the setup
    // callback winning a race against the webhook, or vice versa).
    const nextWorkspaceId = existing.workspace_id ?? workspaceId;
    await supabase
      .from("github_installations")
      .update({
        account_login: account.login,
        account_type: account.type,
        workspace_id: nextWorkspaceId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    return { id: existing.id, workspaceId: nextWorkspaceId };
  }

  const id = randomUUID();
  const { error } = await supabase.from("github_installations").insert({
    id,
    installation_id: installationId,
    account_login: account.login,
    account_type: account.type,
    workspace_id: workspaceId,
  });

  if (error && error.code !== UNIQUE_VIOLATION) {
    throw new Error(`Failed to upsert github_installations: ${error.message}`);
  }
  if (error?.code === UNIQUE_VIOLATION) {
    // Lost a race with a concurrent webhook/setup-callback delivery for
    // the same installation — recurse once to pick up what won.
    return upsertInstallation(installationId, account, workspaceId);
  }

  return { id, workspaceId };
}

export async function deleteInstallation(installationId: string): Promise<void> {
  const supabase = createServiceSupabaseClient();
  // ON DELETE SET NULL on repositories.github_installation_id — repos
  // and their review history are kept, just orphaned from the (now
  // uninstalled) GitHub App connection.
  await supabase.from("github_installations").delete().eq("installation_id", installationId);
}

export async function setInstallationSuspended(
  installationId: string,
  suspended: boolean,
): Promise<void> {
  const supabase = createServiceSupabaseClient();
  await supabase
    .from("github_installations")
    .update({ suspended, updated_at: new Date().toISOString() })
    .eq("installation_id", installationId);
}

export async function upsertRepository(
  repo: GithubRepositoryRef & { default_branch?: string },
  workspaceId: string,
  githubInstallationRowId: string,
): Promise<{ id: string }> {
  const supabase = createServiceSupabaseClient();

  // `installation`/`installation_repositories` webhooks only send the
  // abbreviated repo ref (no `default_branch`) — omit the column rather
  // than write a wrong value; the table's `default 'main'` covers a
  // fresh insert, and an existing row's real value is left untouched on
  // conflict.
  const { data, error } = await supabase
    .from("repositories")
    .upsert(
      {
        workspace_id: workspaceId,
        provider: "github",
        external_repository_id: String(repo.id),
        github_installation_id: githubInstallationRowId,
        name: repo.name,
        full_name: repo.full_name,
        ...(repo.default_branch ? { default_branch: repo.default_branch } : {}),
      },
      { onConflict: "provider,external_repository_id" },
    )
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to upsert repository ${repo.full_name}: ${error?.message}`);
  }

  return { id: data.id };
}

export async function removeRepositoryByExternalId(externalRepositoryId: string): Promise<void> {
  const supabase = createServiceSupabaseClient();
  // Deliberately does not delete the row — a repo the installation lost
  // access to should stop syncing new PRs, not lose its review history.
  // Clearing github_installation_id is enough to mark it "disconnected";
  // it stays visible (read-only, from the reviewer's point of view) via
  // the same workspace membership it always had.
  await supabase
    .from("repositories")
    .update({ github_installation_id: null })
    .eq("provider", "github")
    .eq("external_repository_id", externalRepositoryId);
}

export async function getRepositoryByExternalId(
  externalRepositoryId: string,
): Promise<{ id: string; workspaceId: string; fullName: string } | null> {
  const supabase = createServiceSupabaseClient();
  const { data } = await supabase
    .from("repositories")
    .select("id, workspace_id, full_name")
    .eq("provider", "github")
    .eq("external_repository_id", externalRepositoryId)
    .maybeSingle();

  return data ? { id: data.id, workspaceId: data.workspace_id, fullName: data.full_name } : null;
}

export async function getInstallationWorkspaceId(installationId: string): Promise<string | null> {
  const supabase = createServiceSupabaseClient();
  const { data } = await supabase
    .from("github_installations")
    .select("workspace_id")
    .eq("installation_id", installationId)
    .maybeSingle();
  return data?.workspace_id ?? null;
}

export async function getInstallationRowId(installationId: string): Promise<string | null> {
  const supabase = createServiceSupabaseClient();
  const { data } = await supabase
    .from("github_installations")
    .select("id")
    .eq("installation_id", installationId)
    .maybeSingle();
  return data?.id ?? null;
}

export interface UpsertPullRequestInput {
  repositoryId: string;
  externalId: string;
  number: number;
  title: string;
  sourceBranch: string;
  targetBranch: string;
  authorLogin: string;
  changedFiles: ChangedFile[];
  diffText: string;
  headSha: string;
  baseSha: string;
  /**
   * The real GitHub PR creation time (`pull_request.created_at` from the
   * webhook) — never a ShipSafe-side "now()". Safe to re-send unchanged on
   * every opened/reopened/synchronize event for the same PR: GitHub keeps
   * a PR's `created_at` constant for its lifetime, so upserting it every
   * time is idempotent rather than a special "first insert only" case.
   */
  openedAt: string;
}

export async function upsertPullRequest(input: UpsertPullRequestInput): Promise<{ id: string }> {
  const supabase = createServiceSupabaseClient();

  const { data, error } = await supabase
    .from("pull_requests")
    .upsert(
      {
        repository_id: input.repositoryId,
        external_pull_request_id: input.externalId,
        number: input.number,
        title: input.title,
        source_branch: input.sourceBranch,
        target_branch: input.targetBranch,
        author_login: input.authorLogin,
        changed_files: input.changedFiles,
        diff_text: input.diffText,
        head_sha: input.headSha,
        base_sha: input.baseSha,
        opened_at: input.openedAt,
      },
      { onConflict: "repository_id,number" },
    )
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to upsert pull_requests #${input.number}: ${error?.message}`);
  }

  return { id: data.id };
}

/**
 * Immutable per-commit review row. If a review for this exact
 * (pullRequestId, headSha) pair already exists — a webhook redelivery,
 * or two events racing for the same commit — this returns the existing
 * row instead of creating a duplicate or mutating it. See
 * docs/ARCHITECTURE.md § Commit Binding.
 */
export async function findOrCreatePendingReview(
  pullRequestId: string,
  headSha: string,
  baseSha: string,
  ruleVersion: string,
  truncation: { diffTruncated: boolean; changedFilesTruncated: boolean },
): Promise<{ id: string; alreadyExisted: boolean }> {
  const supabase = createServiceSupabaseClient();

  const existing = await findReviewByHeadSha(pullRequestId, headSha);
  if (existing) return { id: existing.id, alreadyExisted: true };

  const id = randomUUID();
  const { error } = await supabase.from("reviews").insert({
    id,
    pull_request_id: pullRequestId,
    status: "pending",
    reviewed_head_sha: headSha,
    reviewed_base_sha: baseSha,
    rule_version: ruleVersion,
    diff_truncated: truncation.diffTruncated,
    changed_files_truncated: truncation.changedFilesTruncated,
  });

  if (!error) return { id, alreadyExisted: false };

  if (error.code === UNIQUE_VIOLATION) {
    // Lost a race — someone else's insert for this exact commit won.
    const raceWinner = await findReviewByHeadSha(pullRequestId, headSha);
    if (raceWinner) return { id: raceWinner.id, alreadyExisted: true };
  }

  throw new Error(`Failed to create review for head ${headSha}: ${error.message}`);
}

async function findReviewByHeadSha(
  pullRequestId: string,
  headSha: string,
): Promise<{ id: string } | null> {
  const supabase = createServiceSupabaseClient();
  const { data } = await supabase
    .from("reviews")
    .select("id")
    .eq("pull_request_id", pullRequestId)
    .eq("reviewed_head_sha", headSha)
    .maybeSingle();
  return data ?? null;
}

/**
 * Writes the orchestrator's result onto a `pending` review row created by
 * `findOrCreatePendingReview`, plus its reviewer runs and their findings.
 */
export async function completeReview(
  reviewId: string,
  result: OrchestratorResult,
): Promise<void> {
  const supabase = createServiceSupabaseClient();

  const { error: updateError } = await supabase
    .from("reviews")
    .update({
      status: result.status,
      verdict: result.verdict,
      summary: result.summary,
      failure_reason: result.failureReason,
      started_at: result.startedAt,
      completed_at: result.completedAt,
    })
    .eq("id", reviewId);

  if (updateError) {
    throw new Error(`Failed to complete review ${reviewId}: ${updateError.message}`);
  }

  const reviewerRuns = attachReviewIds(reviewId, result.reviewerRuns);

  const runRows = reviewerRuns.map((run) => ({
    id: run.id,
    review_id: run.reviewId,
    reviewer: run.reviewer,
    status: run.status,
    summary: run.summary,
    error_message: run.errorMessage,
    provider: run.providerMetadata?.provider ?? null,
    model: run.providerMetadata?.model ?? null,
    request_id: run.providerMetadata?.requestId ?? null,
    input_tokens: run.providerMetadata?.inputTokens ?? null,
    output_tokens: run.providerMetadata?.outputTokens ?? null,
    latency_ms: run.providerMetadata?.latencyMs ?? null,
    attempt: run.providerMetadata?.attempt ?? 1,
    started_at: run.startedAt,
    completed_at: run.completedAt,
  }));

  if (runRows.length > 0) {
    const { error: runsError } = await supabase.from("reviewer_runs").insert(runRows);
    if (runsError) {
      throw new Error(`Failed to insert reviewer_runs for review ${reviewId}: ${runsError.message}`);
    }
  }

  const findingRows = reviewerRuns.flatMap((run) =>
    run.findings.map((finding) => ({
      id: finding.id,
      reviewer_run_id: finding.reviewerRunId,
      severity: finding.severity,
      title: finding.title,
      description: finding.description,
      file_path: finding.filePath,
      line_start: finding.lineStart,
      line_end: finding.lineEnd,
      category: finding.category,
      recommendation: finding.recommendation,
      confidence: finding.confidence,
    })),
  );

  if (findingRows.length > 0) {
    const { error: findingsError } = await supabase.from("findings").insert(findingRows);
    if (findingsError) {
      throw new Error(`Failed to insert findings for review ${reviewId}: ${findingsError.message}`);
    }
  }
}

/**
 * Marks a review failed outside the normal `completeReview` path — used
 * when the worker itself throws (e.g. it can't even load the PR row, or
 * a write fails) rather than the orchestrator producing a real
 * `OrchestratorResult`. Without this, a crash mid-processing would leave
 * the row stuck at `running` forever instead of failing closed.
 */
export async function failReview(reviewId: string, reason: string): Promise<void> {
  const supabase = createServiceSupabaseClient();
  const now = new Date().toISOString();

  const { error } = await supabase
    .from("reviews")
    .update({
      status: "failed",
      verdict: "DO_NOT_APPROVE",
      summary: reason,
      failure_reason: reason,
      completed_at: now,
    })
    .eq("id", reviewId);

  if (error) {
    throw new Error(`Failed to mark review ${reviewId} failed: ${error.message}`);
  }
}

/**
 * Idempotency guard on GitHub's own `X-GitHub-Delivery` header. Returns
 * `isDuplicate: true` without throwing when this exact delivery has
 * already been recorded (a `23505` unique violation on `delivery_id`) —
 * GitHub retries a delivery it didn't get a fast-enough 2xx for, and this
 * is what lets the Route Handler tell "GitHub retried the same delivery"
 * apart from "a genuinely new event" before doing any real work.
 */
export async function recordWebhookDelivery(
  deliveryId: string,
  eventName: string,
): Promise<{ isDuplicate: boolean }> {
  const supabase = createServiceSupabaseClient();
  const { error } = await supabase
    .from("github_webhook_deliveries")
    .insert({ delivery_id: deliveryId, event: eventName });

  if (!error) return { isDuplicate: false };
  if (error.code === UNIQUE_VIOLATION) return { isDuplicate: true };

  throw new Error(`Failed to record webhook delivery ${deliveryId}: ${error.message}`);
}

export interface QueuedPullRequest {
  title: string;
  sourceBranch: string;
  targetBranch: string;
  changedFiles: ChangedFile[];
  diffText: string;
}

/** The subset of a `pull_requests` row a queued review needs to reconstruct its `ReviewContext`. */
export async function getPullRequestById(id: string): Promise<QueuedPullRequest | null> {
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from("pull_requests")
    .select("title, source_branch, target_branch, changed_files, diff_text")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return null;

  return {
    title: data.title,
    sourceBranch: data.source_branch,
    targetBranch: data.target_branch,
    changedFiles: data.changed_files as ChangedFile[],
    diffText: data.diff_text,
  };
}

export interface ClaimedReview {
  id: string;
  pullRequestId: string;
  diffTruncated: boolean;
  changedFilesTruncated: boolean;
}

/**
 * A review is stuck genuinely mid-processing for at most a few minutes in
 * the worst realistic case (AI_REQUEST_TIMEOUT_MS default 30s × 2
 * attempts × a handful of reviewers, bounded further by
 * AI_MAX_CONCURRENT_REVIEWERS). 10 minutes is a generous margin before a
 * `running` row is assumed to belong to a worker that crashed or was
 * killed mid-job, and is safe to hand to another worker.
 */
const STALE_RUNNING_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Atomically claims the oldest eligible review for processing — either a
 * never-claimed `pending` row, or a `running` row whose worker appears to
 * have died (see `STALE_RUNNING_TIMEOUT_MS`) — and flips it to `running`.
 *
 * Race-safe with any number of concurrent callers (multiple worker
 * processes, or overlapping poll ticks in one process): the eligibility
 * check (`status = pending`, or `status = running AND started_at <
 * cutoff`) is re-evaluated by Postgres at UPDATE time against the current
 * row, not just at the earlier SELECT that found the candidate. If two
 * callers race for the same row, only the first UPDATE actually matches
 * that WHERE clause — by the time the second one runs, `status`/
 * `started_at` already reflect the first caller's write, so the second
 * caller's filter no longer matches and it claims nothing for that row.
 */
export async function claimNextPendingReview(): Promise<ClaimedReview | null> {
  const supabase = createServiceSupabaseClient();
  const staleCutoff = new Date(Date.now() - STALE_RUNNING_TIMEOUT_MS).toISOString();
  const eligibleFilter = `status.eq.pending,and(status.eq.running,started_at.lt.${staleCutoff})`;

  const { data: candidates, error: selectError } = await supabase
    .from("reviews")
    .select("id")
    .or(eligibleFilter)
    .order("queued_at", { ascending: true })
    .limit(10);

  if (selectError || !candidates || candidates.length === 0) return null;

  const now = new Date().toISOString();

  for (const candidate of candidates) {
    const { data: claimed, error: updateError } = await supabase
      .from("reviews")
      .update({ status: "running", started_at: now })
      .eq("id", candidate.id)
      .or(eligibleFilter)
      .select("id, pull_request_id, diff_truncated, changed_files_truncated")
      .maybeSingle();

    if (!updateError && claimed) {
      return {
        id: claimed.id,
        pullRequestId: claimed.pull_request_id,
        diffTruncated: claimed.diff_truncated,
        changedFilesTruncated: claimed.changed_files_truncated,
      };
    }
    // Lost the race (or someone else already finished it) — try the next candidate.
  }

  return null;
}
