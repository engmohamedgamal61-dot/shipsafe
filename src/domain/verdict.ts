import { REVIEWER_LABEL, type Finding, type ReviewerKind, type ReviewerRun, type Verdict } from "./types";

/**
 * Every specialist reviewer is required in Phase 1 — there is no product
 * reason yet to let a review proceed without one of them, so a missing
 * result must block, not silently pass through with zero findings. The
 * Release Judge is not itself "required" here: its own failure is handled
 * separately by the orchestrator (see `ReleaseJudgeAgent`), since without
 * it there is no judge to consult in the first place.
 */
export const REQUIRED_REVIEWERS: readonly ReviewerKind[] = [
  "code",
  "security",
  "architecture",
  "database",
  "test",
];

/**
 * A discriminated union (rather than `{ blocked: boolean; failureReason:
 * string | null }`) so callers get real type narrowing: once
 * `blocked` is checked, `failureReason` is known to be a `string` (not
 * `string | null`) without a manual assertion.
 */
export type RequiredReviewerCheck =
  | { blocked: true; failureReason: string }
  | { blocked: false; failureReason: null };

/**
 * Fail-closed guardrail: if any required reviewer didn't complete, the
 * review can never produce an approval — regardless of how few findings
 * the reviewers that *did* succeed reported. A failed reviewer contributes
 * zero findings, so without this check a required reviewer crashing would
 * silently look identical to "that reviewer found nothing wrong".
 */
export function checkRequiredReviewers(
  reviewerRuns: readonly ReviewerRun[],
  requiredReviewers: readonly ReviewerKind[] = REQUIRED_REVIEWERS,
): RequiredReviewerCheck {
  const byReviewer = new Map(reviewerRuns.map((run) => [run.reviewer, run]));

  const failed = requiredReviewers.filter((reviewer) => {
    const run = byReviewer.get(reviewer);
    return !run || run.status !== "complete";
  });

  if (failed.length === 0) {
    return { blocked: false, failureReason: null };
  }

  const names = failed.map((reviewer) => REVIEWER_LABEL[reviewer]).join(", ");
  return {
    blocked: true,
    failureReason: `Required reviewer(s) did not complete successfully: ${names}. A release verdict cannot be trusted without their findings — re-run the review.`,
  };
}

/**
 * Deterministic guardrail applied on top of the Release Judge's raw
 * output. The judge's own reasoning can be more conservative than this
 * floor, but it can never be more lenient — a P0 finding always blocks
 * approval, no matter what an AI provider decides. This keeps the verdict
 * a guarantee rather than a suggestion.
 */
export function applyVerdictFloor(
  findings: readonly Finding[],
  judgeVerdict: Verdict,
): Verdict {
  const floor = minimumVerdictFor(findings);
  return isAtLeastAsStrict(floor, judgeVerdict) ? floor : judgeVerdict;
}

/** The most lenient verdict the given findings could ever justify. */
export function minimumVerdictFor(findings: readonly Finding[]): Verdict {
  const hasP0 = findings.some((f) => f.severity === "P0");
  if (hasP0) return "DO_NOT_APPROVE";

  const p1Count = findings.filter((f) => f.severity === "P1").length;
  if (p1Count >= 3) return "DO_NOT_APPROVE";
  if (p1Count > 0) return "APPROVE_WITH_MINOR_FIXES";

  const hasP2OrNit = findings.some(
    (f) => f.severity === "P2" || f.severity === "NIT",
  );
  if (hasP2OrNit) return "APPROVE_WITH_MINOR_FIXES";

  return "APPROVE";
}

const STRICTNESS: Record<Verdict, number> = {
  APPROVE: 0,
  APPROVE_WITH_MINOR_FIXES: 1,
  DO_NOT_APPROVE: 2,
};

function isAtLeastAsStrict(a: Verdict, b: Verdict): boolean {
  return STRICTNESS[a] > STRICTNESS[b];
}
