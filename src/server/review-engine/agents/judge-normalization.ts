import type { ReviewerRun } from "@/domain/types";
import type { ReleaseJudgeOutput } from "../providers/judge-provider";

/**
 * Release-Judge-specific post-processing, applied by `ReleaseJudgeAgent`
 * to every raw port response.
 *
 * Deliberately narrow, and DISTINCT from `@/domain/verdict`'s
 * `applyVerdictFloor`/`minimumVerdictFor`/`checkRequiredReviewers` — those
 * remain the orchestrator's own, unmodified, single source of truth for
 * the deterministic floor a review's FINAL verdict can never fall below,
 * enforced independently of anything the judge or this module does. This
 * module exists only to fix the one narrower, specific defect the
 * Release Judge's real baseline actually measured
 * (`docs/agents/release-judge-baseline-current.md`): given only
 * low-severity findings (a single Nit and a P2), the raw judge sometimes
 * returned APPROVE outright rather than APPROVE_WITH_MINOR_FIXES.
 * Production users were never affected by this — the orchestrator's
 * floor already silently corrects it — but the RAW judge output should
 * already be correct on its own, not rely on a downstream correction it
 * doesn't know is coming.
 *
 * Every other measured judge behavior (confirmed-blocker discipline,
 * duplicate root-cause handling, low-confidence caution, grounding) was
 * already correct at baseline, so this module makes no attempt to
 * re-derive or duplicate that reasoning deterministically — that stays
 * entirely the model's job, reinforced only by `prompt.ts`'s explicit
 * instructions, never by code here.
 */
const VERDICT_STRICTNESS: Record<ReleaseJudgeOutput["verdict"], number> = {
  APPROVE: 0,
  APPROVE_WITH_MINOR_FIXES: 1,
  DO_NOT_APPROVE: 2,
};

/**
 * Upgrades a raw APPROVE to APPROVE_WITH_MINOR_FIXES whenever at least
 * one finding of any severity exists across any reviewer run —
 * deliberately the ONLY rule this function enforces (not the full
 * P0/three-or-more-P1 escalation `minimumVerdictFor` already computes
 * elsewhere), since that's the one calibration gap the baseline
 * actually measured. Never touches an already-stricter verdict (a judge
 * that correctly said DO_NOT_APPROVE or APPROVE_WITH_MINOR_FIXES is left
 * exactly as it was), and never produces anything looser than what the
 * judge itself returned, and never alters `summary`.
 */
export function enforceMinimumVerdictForAnyFinding(output: ReleaseJudgeOutput, reviewerRuns: readonly ReviewerRun[]): ReleaseJudgeOutput {
  const hasAnyFinding = reviewerRuns.some((run) => run.findings.length > 0);
  if (!hasAnyFinding) return output;
  if (VERDICT_STRICTNESS[output.verdict] >= VERDICT_STRICTNESS.APPROVE_WITH_MINOR_FIXES) return output;
  return { ...output, verdict: "APPROVE_WITH_MINOR_FIXES" };
}
