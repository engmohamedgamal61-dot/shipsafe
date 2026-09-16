import type { ReviewerRun } from "@/domain/types";
import type { ReleaseJudgePort, ReleaseJudgeResult } from "../providers/judge-provider";

/**
 * Thin wrapper over `ReleaseJudgePort` — kept as its own class (rather than
 * calling the port directly from the orchestrator) so the orchestrator's
 * dependency list reads symmetrically with the five specialist agents, and
 * so a future change to what the judge needs (e.g. the original diff, for
 * a second-pass sanity check) has one call site to update.
 */
export class ReleaseJudgeAgent {
  readonly kind = "judge" as const;

  constructor(private readonly port: ReleaseJudgePort) {}

  judge(reviewerRuns: readonly ReviewerRun[], attempt: number): Promise<ReleaseJudgeResult> {
    return this.port.judge({ reviewerRuns: [...reviewerRuns], attempt });
  }
}
