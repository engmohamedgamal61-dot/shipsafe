import { randomUUID } from "node:crypto";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { attachReviewIds, type OrchestratorResult } from "@/server/review-engine/orchestrator";
import type { ChangedFile } from "@/domain/types";
import type { GithubAccount, GithubRepositoryPayload } from "./types";

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
  repo: GithubRepositoryPayload,
  workspaceId: string,
  githubInstallationRowId: string,
): Promise<{ id: string }> {
  const supabase = createServiceSupabaseClient();

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
        default_branch: repo.default_branch,
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
    })),
  );

  if (findingRows.length > 0) {
    const { error: findingsError } = await supabase.from("findings").insert(findingRows);
    if (findingsError) {
      throw new Error(`Failed to insert findings for review ${reviewId}: ${findingsError.message}`);
    }
  }
}
