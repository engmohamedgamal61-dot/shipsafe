import type { ReviewerRun } from "@/domain/types";
import type { ReleaseJudgePort, ReleaseJudgeResult } from "../providers/judge-provider";
import { enforceMinimumVerdictForAnyFinding } from "./judge-normalization";

/**
 * Thin wrapper over `ReleaseJudgePort` — kept as its own class (rather than
 * calling the port directly from the orchestrator) so the orchestrator's
 * dependency list reads symmetrically with the five specialist agents, and
 * so a future change to what the judge needs (e.g. the original diff, for
 * a second-pass sanity check) has one call site to update.
 *
 * Applies `enforceMinimumVerdictForAnyFinding` to the port's raw output
 * before returning it — a narrow, deterministic backstop for the one
 * calibration defect the Release Judge's real baseline measured (see
 * `judge-normalization.ts`'s header comment). This runs regardless of
 * which `ReleaseJudgePort` is plugged in (the real Anthropic-backed one
 * or `MockReleaseJudgeProvider`), same as the five specialist reviewer
 * agents' own normalization runs regardless of `AIProvider`.
 */
export class ReleaseJudgeAgent {
  readonly kind = "judge" as const;

  constructor(private readonly port: ReleaseJudgePort) {}

  async judge(reviewerRuns: readonly ReviewerRun[], attempt: number): Promise<ReleaseJudgeResult> {
    const result = await this.port.judge({ reviewerRuns: [...reviewerRuns], attempt });
    return { ...result, output: enforceMinimumVerdictForAnyFinding(result.output, reviewerRuns) };
  }
}
