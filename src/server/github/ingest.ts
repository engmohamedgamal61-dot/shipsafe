import { logger } from "@/lib/logger";
import { ReviewOrchestrator } from "@/server/review-engine/orchestrator";
import { REVIEW_RULE_VERSION } from "@/server/review-engine/version";
import { getAIProvider, getReleaseJudgePort } from "@/server/container";
import { fetchPullRequestDiff, fetchPullRequestFiles, getInstallationToken } from "./client";
import { hardenPullRequestInput } from "./pr-hardening";
import type {
  GithubInstallationRepositoriesWebhookBody,
  GithubInstallationWebhookBody,
  GithubPullRequestWebhookBody,
  GithubRepositoryPayload,
} from "./types";
import {
  claimNextPendingReview,
  completeReview,
  deleteInstallation,
  failReview,
  findOrCreatePendingReview,
  getInstallationRowId,
  getInstallationWorkspaceId,
  getPullRequestById,
  getRepositoryByExternalId,
  removeRepositoryByExternalId,
  setInstallationSuspended,
  upsertInstallation,
  upsertPullRequest,
  upsertRepository,
} from "./writes";

const PULL_REQUEST_ACTIONS_TO_REVIEW = new Set(["opened", "reopened", "synchronize"]);

/**
 * Handles the `installation` webhook event: an app was installed,
 * uninstalled, suspended, or unsuspended for some GitHub account.
 *
 * `created` intentionally does NOT sync repositories here — at the
 * moment this webhook fires, we don't yet know which ShipSafe workspace
 * initiated the install (GitHub delivers this independently of, and
 * often before, the user's browser completing the Setup URL redirect).
 * The Setup URL callback (`src/app/api/github/setup/route.ts`) is what
 * links `workspace_id` AND does the initial repository sync, once it has
 * that link. See `docs/GITHUB_INTEGRATION.md`.
 */
export async function handleInstallationEvent(body: GithubInstallationWebhookBody): Promise<void> {
  const installationId = String(body.installation.id);

  switch (body.action) {
    case "created":
      await upsertInstallation(installationId, body.installation.account, null);
      return;
    case "deleted":
      await deleteInstallation(installationId);
      return;
    case "suspend":
      await setInstallationSuspended(installationId, true);
      return;
    case "unsuspend":
      await setInstallationSuspended(installationId, false);
      return;
    default:
      logger.info("ignoring unhandled installation action", { action: body.action });
  }
}

/** Keeps `repositories` in sync as a user adds/removes repos from an existing installation. */
export async function handleInstallationRepositoriesEvent(
  body: GithubInstallationRepositoriesWebhookBody,
): Promise<void> {
  const installationId = String(body.installation.id);
  const workspaceId = await getInstallationWorkspaceId(installationId);

  if (!workspaceId) {
    // Not linked to a workspace yet (setup-URL callback hasn't run) —
    // nothing to attach these repos to. The callback's own full
    // installation-repositories sync will pick these up once it runs.
    logger.info("skipping installation_repositories event for unlinked installation", {
      installationId,
    });
    return;
  }

  const installationRowId = await getInstallationRowId(installationId);
  if (!installationRowId) return;

  for (const repo of body.repositories_added ?? []) {
    await upsertRepository(repo, workspaceId, installationRowId);
  }
  for (const repo of body.repositories_removed ?? []) {
    await removeRepositoryByExternalId(String(repo.id));
  }
}

/**
 * Handles a `pull_request` webhook: ingests the PR's current state and
 * creates an immutable, durably-queued review row bound to the exact head
 * SHA (skipping if one already exists for this commit — see
 * `findOrCreatePendingReview`), then returns.
 *
 * Deliberately does NOT run the review engine itself. `reviews.status =
 * 'pending'` IS the durable enqueue — it's a committed Postgres row, so it
 * survives a server restart on its own — and a background worker
 * (`processPendingReviews` below, driven by `src/instrumentation.ts`)
 * picks it up independently. Running the AI pipeline inline here is what
 * used to make this handler take longer than GitHub's ~10s webhook
 * timeout; this function now only ever does GitHub-API + database calls
 * fast enough to stay well under it.
 */
export async function handlePullRequestEvent(body: GithubPullRequestWebhookBody): Promise<void> {
  if (!PULL_REQUEST_ACTIONS_TO_REVIEW.has(body.action)) {
    return;
  }
  if (!body.installation) {
    logger.error("pull_request webhook missing installation — cannot authenticate to GitHub", {
      repository: body.repository.full_name,
    });
    return;
  }

  const externalRepositoryId = String(body.repository.id);
  let repository = await getRepositoryByExternalId(externalRepositoryId);

  if (!repository) {
    repository = await ensureRepositoryFromWebhook(body.repository, String(body.installation.id));
    if (!repository) {
      logger.error("could not resolve or create repository for pull_request webhook", {
        repository: body.repository.full_name,
      });
      return;
    }
  }

  const [owner, repo] = body.repository.full_name.split("/");
  const token = await getInstallationToken(String(body.installation.id));

  const [rawDiffText, rawFiles] = await Promise.all([
    fetchPullRequestDiff(owner, repo, body.pull_request.number, token),
    fetchPullRequestFiles(owner, repo, body.pull_request.number, token),
  ]);
  const { diffText, changedFiles, diffTruncated, changedFilesTruncated, totalChangedFileCount } =
    hardenPullRequestInput(rawDiffText, rawFiles);

  if (diffTruncated || changedFilesTruncated) {
    logger.info("PR input exceeded ingest limits — truncated before persisting and reviewing", {
      repository: body.repository.full_name,
      pullRequestNumber: body.pull_request.number,
      diffTruncated,
      changedFilesTruncated,
      totalChangedFileCount,
      reviewedChangedFileCount: changedFiles.length,
    });
  }

  const { id: pullRequestId } = await upsertPullRequest({
    repositoryId: repository.id,
    externalId: String(body.pull_request.id),
    number: body.pull_request.number,
    title: body.pull_request.title,
    sourceBranch: body.pull_request.head.ref,
    targetBranch: body.pull_request.base.ref,
    authorLogin: body.pull_request.user.login,
    changedFiles,
    diffText,
    headSha: body.pull_request.head.sha,
    baseSha: body.pull_request.base.sha,
    openedAt: body.pull_request.created_at,
  });

  const { id: reviewId, alreadyExisted } = await findOrCreatePendingReview(
    pullRequestId,
    body.pull_request.head.sha,
    body.pull_request.base.sha,
    REVIEW_RULE_VERSION,
    { diffTruncated, changedFilesTruncated },
  );

  if (alreadyExisted) {
    logger.info("review already exists for this commit — skipping re-queue", {
      repository: body.repository.full_name,
      pullRequestNumber: body.pull_request.number,
      headSha: body.pull_request.head.sha,
    });
    return;
  }

  logger.info("queued review for real GitHub PR", {
    repository: body.repository.full_name,
    pullRequestNumber: body.pull_request.number,
    headSha: body.pull_request.head.sha,
    reviewId,
  });
}

/**
 * Drains the review queue: repeatedly claims the oldest eligible `reviews`
 * row (see `claimNextPendingReview`) and runs it through the existing
 * `ReviewOrchestrator` until none are left. Called on a timer by the
 * background worker (`src/instrumentation.ts`) — never from the webhook
 * Route Handler, which is exactly the coupling this exists to remove.
 *
 * Sequential by design: each claimed review still runs its 5 specialist
 * reviewers concurrently (the orchestrator's own `Promise.all`, bounded by
 * `AI_MAX_CONCURRENT_REVIEWERS`), so this doesn't serialize individual AI
 * calls — it just avoids adding a second, uncoordinated concurrency
 * dimension on top of that existing cap.
 */
export async function processPendingReviews(): Promise<{ processed: number }> {
  let processed = 0;

  for (;;) {
    const claimed = await claimNextPendingReview();
    if (!claimed) break;

    await processClaimedReview(claimed);
    processed += 1;
  }

  return { processed };
}

async function processClaimedReview(claimed: {
  id: string;
  pullRequestId: string;
  diffTruncated: boolean;
  changedFilesTruncated: boolean;
}): Promise<void> {
  try {
    const pullRequest = await getPullRequestById(claimed.pullRequestId);
    if (!pullRequest) {
      throw new Error(`pull_request ${claimed.pullRequestId} not found for queued review ${claimed.id}`);
    }

    const orchestrator = new ReviewOrchestrator(getAIProvider(), getReleaseJudgePort());
    const result = await orchestrator.run({
      pullRequestTitle: pullRequest.title,
      sourceBranch: pullRequest.sourceBranch,
      targetBranch: pullRequest.targetBranch,
      changedFiles: pullRequest.changedFiles,
      diffText: pullRequest.diffText,
      diffTruncated: claimed.diffTruncated,
      changedFilesTruncated: claimed.changedFilesTruncated,
    });

    await completeReview(claimed.id, result);

    logger.info("processed queued review", {
      reviewId: claimed.id,
      status: result.status,
      verdict: result.verdict,
    });
  } catch (error) {
    // The orchestrator itself never throws (every reviewer/judge failure
    // is caught internally and turned into a fail-closed result — see
    // ReviewOrchestrator.run()) — reaching here means something outside
    // it broke (a missing PR row, a database write failing). Fail closed
    // here too rather than leaving the row stuck at 'running' forever.
    const message = error instanceof Error ? error.message : String(error);
    logger.error("worker failed to process queued review", { reviewId: claimed.id, error: message });
    await failReview(claimed.id, `Review processing failed: ${message}`);
  }
}

async function ensureRepositoryFromWebhook(
  repo: GithubRepositoryPayload,
  installationId: string,
): Promise<{ id: string; workspaceId: string; fullName: string } | null> {
  const workspaceId = await getInstallationWorkspaceId(installationId);
  if (!workspaceId) return null;

  const installationRowId = await getInstallationRowId(installationId);
  if (!installationRowId) return null;

  const { id } = await upsertRepository(repo, workspaceId, installationRowId);
  return { id, workspaceId, fullName: repo.full_name };
}
