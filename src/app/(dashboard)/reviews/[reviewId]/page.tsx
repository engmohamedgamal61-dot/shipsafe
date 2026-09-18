import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { requireSession } from "@/server/auth/require-session";
import { getReviewRepository } from "@/server/container";
import { countBySeverity } from "@/domain/types";
import { VerdictBanner } from "@/components/dashboard/verdict-banner";
import { VerdictPill } from "@/components/dashboard/verdict-pill";
import { SeverityCountsRow } from "@/components/dashboard/severity-counts-row";
import { StatusStrip } from "@/components/dashboard/status-strip";
import { ReviewerStatusList } from "@/components/dashboard/reviewer-status-list";
import { ChangedFilesList } from "@/components/dashboard/changed-files-list";
import { FindingList, type FindingWithReviewer } from "@/components/dashboard/finding-list";
import { TruncationNotice } from "@/components/dashboard/truncation-notice";
import { LocalDateTime } from "@/components/dashboard/local-date-time";
import { ReviewStageProgress } from "@/components/dashboard/review-stage-progress";
import { AutoRefresh } from "@/components/dashboard/auto-refresh";
import { isReviewInProgress } from "@/lib/review-status";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Shown instead of `review.summary`/`failureReason` when a review fails —
 * those can contain interpolated provider error text (see
 * ReviewOrchestrator.run()'s judge-failure path), which never belongs in
 * front of a tester. The real error is still logged server-side.
 */
const SAFE_FAILURE_SUMMARY =
  "This review could not be completed. ShipSafe's fail-closed policy blocks approval whenever a reviewer or the Release Judge doesn't finish successfully — re-run the review once the underlying issue is resolved.";

export default async function ReviewDetailPage({
  params,
}: PageProps<"/reviews/[reviewId]">) {
  const { reviewId } = await params;
  const session = await requireSession();
  const review = await getReviewRepository().getReviewById(session.userId, reviewId);

  if (!review) {
    notFound();
  }

  const findings: FindingWithReviewer[] = review.reviewerRuns.flatMap((run) =>
    run.findings.map((finding) => ({ ...finding, reviewer: run.reviewer })),
  );
  const counts = countBySeverity(findings);
  const githubUrl =
    review.repository.provider === "github"
      ? `https://github.com/${review.repository.fullName}/pull/${review.pullRequest.number}`
      : null;

  return (
    <div className="flex flex-col gap-6">
      <AutoRefresh active={isReviewInProgress(review.status)} />
      <div>
        <div className="flex items-center gap-2">
          <p className="text-sm text-muted-foreground">
            {review.repository.fullName} · #{review.pullRequest.number}
          </p>
          {githubUrl && (
            <a
              href={githubUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-sm text-brand hover:underline"
            >
              View on GitHub
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          )}
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">{review.pullRequest.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {review.pullRequest.authorLogin} wants to merge{" "}
          <span className="font-mono">{review.pullRequest.sourceBranch}</span> into{" "}
          <span className="font-mono">{review.pullRequest.targetBranch}</span>
        </p>
        <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
          <LocalDateTime prefix="Opened" iso={review.pullRequest.openedAt} />
          {review.completedAt && <LocalDateTime prefix="Last reviewed" iso={review.completedAt} />}
        </p>
      </div>

      <TruncationNotice
        diffTruncated={review.diffTruncated}
        changedFilesTruncated={review.changedFilesTruncated}
      />

      {review.status === "failed" ? (
        <VerdictBanner verdict="DO_NOT_APPROVE" summary={SAFE_FAILURE_SUMMARY} />
      ) : review.verdict && review.summary ? (
        <VerdictBanner verdict={review.verdict} summary={review.summary} />
      ) : (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-surface p-5">
          <VerdictPill verdict={null} status={review.status} />
          <p className="text-sm text-muted-foreground">
            {review.status === "running"
              ? "ShipSafe is reviewing this pull request now — findings will appear here as they're ready."
              : "This pull request is queued for review and will start shortly."}
          </p>
        </div>
      )}

      {isReviewInProgress(review.status) && (
        <Card>
          <CardHeader>
            <CardTitle>Review progress</CardTitle>
          </CardHeader>
          <CardContent>
            <ReviewStageProgress reviewStatus={review.status} reviewerRuns={review.reviewerRuns} />
          </CardContent>
        </Card>
      )}

      <StatusStrip reviewerRuns={review.reviewerRuns} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Findings</CardTitle>
              <SeverityCountsRow counts={counts} />
            </CardHeader>
            <CardContent>
              <FindingList findings={findings} />
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Reviewers</CardTitle>
            </CardHeader>
            <CardContent>
              <ReviewerStatusList runs={review.reviewerRuns} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Changed files</CardTitle>
            </CardHeader>
            <CardContent>
              <ChangedFilesList files={review.pullRequest.changedFiles} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
