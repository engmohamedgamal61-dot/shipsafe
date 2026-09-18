import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { requireSession } from "@/server/auth/require-session";
import { getReviewRepository } from "@/server/container";
import { countBySeverity } from "@/domain/types";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { VerdictPill } from "@/components/dashboard/verdict-pill";
import { SeverityCountsRow } from "@/components/dashboard/severity-counts-row";
import { LocalDateTime } from "@/components/dashboard/local-date-time";

export default async function DashboardPage() {
  const session = await requireSession();
  const reviews = await getReviewRepository().listReviewsForUser(session.userId);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reviews</h1>
        <p className="mt-1 text-muted-foreground">
          Every pull request ShipSafe has reviewed across your connected repositories.
        </p>
      </div>

      {reviews.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            No reviews yet. Connect a repository to get started.
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {reviews.map((review) => {
            const allFindings = review.reviewerRuns.flatMap((run) => run.findings);
            const counts = countBySeverity(allFindings);

            return (
              <Link key={review.id} href={`/reviews/${review.id}`}>
                <Card className="transition-colors hover:border-brand/50">
                  <CardHeader className="flex-row items-start justify-between gap-4">
                    <div>
                      <CardTitle>{review.pullRequest.title}</CardTitle>
                      <CardDescription>
                        {review.repository.fullName} · #{review.pullRequest.number} ·{" "}
                        {review.pullRequest.sourceBranch} → {review.pullRequest.targetBranch}
                      </CardDescription>
                      <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                        <LocalDateTime prefix="Opened" iso={review.pullRequest.openedAt} />
                        {review.completedAt && (
                          <LocalDateTime prefix="Last reviewed" iso={review.completedAt} />
                        )}
                      </p>
                    </div>
                    <VerdictPill verdict={review.verdict} />
                  </CardHeader>
                  <CardContent className="flex items-center justify-between gap-4">
                    <SeverityCountsRow counts={counts} />
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
