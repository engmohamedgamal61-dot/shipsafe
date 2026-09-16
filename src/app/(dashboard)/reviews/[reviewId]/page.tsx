import { notFound } from "next/navigation";
import { requireSession } from "@/server/auth/require-session";
import { getReviewRepository } from "@/server/container";
import { countBySeverity } from "@/domain/types";
import { VerdictBanner } from "@/components/dashboard/verdict-banner";
import { SeverityCountsRow } from "@/components/dashboard/severity-counts-row";
import { StatusStrip } from "@/components/dashboard/status-strip";
import { ReviewerStatusList } from "@/components/dashboard/reviewer-status-list";
import { ChangedFilesList } from "@/components/dashboard/changed-files-list";
import { FindingList, type FindingWithReviewer } from "@/components/dashboard/finding-list";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm text-muted-foreground">
          {review.repository.fullName} · #{review.pullRequest.number}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{review.pullRequest.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {review.pullRequest.authorLogin} wants to merge{" "}
          <span className="font-mono">{review.pullRequest.sourceBranch}</span> into{" "}
          <span className="font-mono">{review.pullRequest.targetBranch}</span>
        </p>
      </div>

      {review.verdict && review.summary && (
        <VerdictBanner verdict={review.verdict} summary={review.summary} />
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
