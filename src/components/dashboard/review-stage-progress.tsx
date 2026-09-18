import { CheckCircle2, CircleDashed, Loader2, XCircle } from "lucide-react";
import type { ReviewerKind, ReviewerRun, RunStatus } from "@/domain/types";
import { cn } from "@/lib/utils";

export type StageState = "waiting" | "running" | "complete" | "failed";

const STAGE_ORDER: ReviewerKind[] = ["code", "security", "architecture", "database", "test", "judge"];

/** Short labels for the compact progress row — `REVIEWER_LABEL`'s full names ("Code Reviewer", …) don't fit six-across in a card. */
const STAGE_LABEL: Record<ReviewerKind, string> = {
  code: "Code",
  security: "Security",
  architecture: "Architecture",
  database: "Database",
  test: "Test",
  judge: "Judge",
};

const STAGE_ICON: Record<StageState, typeof CheckCircle2> = {
  waiting: CircleDashed,
  running: Loader2,
  complete: CheckCircle2,
  failed: XCircle,
};

const STAGE_CLASSES: Record<StageState, string> = {
  waiting: "text-muted-foreground",
  running: "text-severity-p2 animate-spin",
  complete: "text-verdict-approve",
  failed: "text-verdict-block",
};

/**
 * `reviewer_runs` rows are only persisted once the whole orchestrator run
 * finishes (see `completeReview` in src/server/github/writes.ts) — there
 * is no live per-reviewer row to read while a review is still
 * pending/running. Rather than changing that (a real worker/persistence
 * change, out of scope here — see docs/ARCHITECTURE.md § Multi-Agent
 * Review Flow), this approximates from how the orchestrator is known to
 * sequence work: the 5 specialists run concurrently first, and the judge
 * only ever starts after every one of them has finished
 * (`ReviewOrchestrator.run()`). Once a `ReviewerRun` row does exist, its
 * own status is authoritative and this stops guessing for that reviewer.
 */
export function stageStateFor(
  reviewer: ReviewerKind,
  reviewStatus: RunStatus,
  reviewerRuns: readonly ReviewerRun[],
): StageState {
  const run = reviewerRuns.find((r) => r.reviewer === reviewer);

  if (run) {
    if (run.status === "complete") return "complete";
    if (run.status === "failed") return "failed";
    if (run.status === "running") return "running";
    return "waiting"; // run.status === "pending" — e.g. the judge, skipped by the fail-closed required-reviewer check
  }

  if (reviewStatus === "running") return reviewer === "judge" ? "waiting" : "running";
  return "waiting"; // reviewStatus is "pending" (not yet started) or a terminal state with no run row for this reviewer
}

/**
 * Compact six-stage progress row (the 5 specialist reviewers + Release
 * Judge) — used on both the dashboard list cards and the review detail
 * page, so the two never show inconsistent progress for the same review.
 */
export function ReviewStageProgress({
  reviewStatus,
  reviewerRuns,
}: {
  reviewStatus: RunStatus;
  reviewerRuns: readonly ReviewerRun[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-3" role="list" aria-label="Review stage progress">
      {STAGE_ORDER.map((reviewer) => {
        const state = stageStateFor(reviewer, reviewStatus, reviewerRuns);
        const Icon = STAGE_ICON[state];
        return (
          <div
            key={reviewer}
            role="listitem"
            aria-label={`${STAGE_LABEL[reviewer]}: ${state}`}
            className="flex items-center gap-1 text-xs text-muted-foreground"
          >
            <Icon className={cn("h-3.5 w-3.5 shrink-0", STAGE_CLASSES[state])} aria-hidden />
            <span>{STAGE_LABEL[reviewer]}</span>
          </div>
        );
      })}
    </div>
  );
}
