import {
  SEVERITY_LABEL,
  VERDICT_LABEL,
  countBySeverity,
  type Finding,
  type ProviderExecutionMetadata,
  type ReviewerRun,
  type Verdict,
} from "@/domain/types";
import { minimumVerdictFor } from "@/domain/verdict";

export interface ReleaseJudgeInput {
  reviewerRuns: ReviewerRun[];
  /** Which attempt this is (1 = first try) — same retry contract as `AgentReviewInput`. */
  attempt: number;
}

export interface ReleaseJudgeOutput {
  verdict: Verdict;
  summary: string;
}

export interface ReleaseJudgeResult {
  output: ReleaseJudgeOutput;
  metadata: ProviderExecutionMetadata;
}

/**
 * Port for whatever ultimately decides the release verdict. Deliberately
 * distinct from `AIProvider`: the judge consolidates other reviewers'
 * findings rather than reviewing a diff itself, so forcing it through the
 * diff-reviewer interface only produces dead branches in a real
 * implementation. `AnthropicJudgeProvider` (Phase 2) implements this same
 * port with an LLM call.
 *
 * IMPORTANT: this port's output is NOT trusted as the final verdict.
 * `ReviewOrchestrator.run()` is the single place that (a) decides whether
 * the judge gets called at all — a required reviewer that didn't complete
 * skips the judge entirely — and (b) clamps whatever verdict this port
 * returns to the deterministic floor computed from the findings
 * (`applyVerdictFloor`). A judge implementation is therefore free to be
 * wrong in the lenient direction (a bug, a model that gets talked into
 * `APPROVE`) without that ever reaching a user: see
 * `orchestrator.test.ts`'s adversarial "always APPROVE" judge test.
 */
export interface ReleaseJudgePort {
  judge(input: ReleaseJudgeInput): Promise<ReleaseJudgeResult>;
}

export class MockReleaseJudgeProvider implements ReleaseJudgePort {
  async judge(input: ReleaseJudgeInput): Promise<ReleaseJudgeResult> {
    const startedAt = Date.now();
    const allFindings = input.reviewerRuns.flatMap((run) => run.findings);
    const verdict = minimumVerdictFor(allFindings);
    const summary = buildSummary(allFindings, verdict);

    return {
      output: { verdict, summary },
      metadata: {
        provider: "mock",
        model: "heuristic-judge-v1",
        requestId: null,
        inputTokens: null,
        outputTokens: null,
        latencyMs: Date.now() - startedAt,
        attempt: input.attempt,
      },
    };
  }
}

function buildSummary(findings: readonly Finding[], verdict: Verdict): string {
  const counts = countBySeverity(findings);

  if (findings.length === 0) {
    return "No issues were found across any reviewer. This change looks safe to ship.";
  }

  const parts = (Object.keys(counts) as (keyof typeof counts)[])
    .filter((severity) => counts[severity] > 0)
    .map((severity) => `${counts[severity]} ${SEVERITY_LABEL[severity]}`);

  const headline = `${findings.length} finding(s) across all reviewers: ${parts.join(", ")}.`;

  const verdictReason =
    verdict === "DO_NOT_APPROVE"
      ? counts.P0 > 0
        ? "At least one critical (P0) issue must be resolved before this can merge."
        : "Multiple high-priority (P1) issues together represent unacceptable risk to ship as-is."
      : verdict === "APPROVE_WITH_MINOR_FIXES"
        ? "Nothing release-blocking, but the open items below are worth addressing before or shortly after merge."
        : "No blocking or notable issues were found.";

  return `${headline} Verdict: ${VERDICT_LABEL[verdict]}. ${verdictReason}`;
}
