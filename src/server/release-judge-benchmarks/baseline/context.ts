import type { Finding, ReviewerRun } from "@/domain/types";
import type { LoadedFixture } from "../load-fixtures";

/**
 * Builds the exact `ReviewerRun[]` shape production feeds
 * `ReleaseJudgePort.judge()` (via `ReleaseJudgeAgent.judge`), from a
 * Release Judge benchmark fixture's simulated specialist runs. Unlike
 * the five specialist reviewers' `baseline/context.ts` (which
 * synthesize a unified diff), there is no diff here — the judge never
 * sees raw code, only other reviewers' structured output, so this
 * function's only job is filling in the DB-only id/timestamp
 * scaffolding (`Finding.id`, `Finding.reviewerRunId`, `ReviewerRun.id`,
 * `.reviewId`, `.startedAt`, `.completedAt`, `.providerMetadata`,
 * `.errorMessage`) that the fixture's ground truth doesn't need to
 * specify, since the judge port ignores all of it and only reads
 * `reviewer`, `status`, `summary`, and `findings`.
 */
export function buildReviewerRunsFromFixture(fixture: LoadedFixture): ReviewerRun[] {
  return fixture.manifest.reviewer_runs.map((run, runIndex) => {
    const runId = `${fixture.manifest.fixture_id}-run-${runIndex}-${run.reviewer}`;

    const findings: Finding[] = run.findings.map((f) => ({
      id: f.id,
      reviewerRunId: runId,
      severity: f.severity,
      title: f.title,
      description: f.description,
      filePath: f.filePath,
      lineStart: f.lineStart,
      lineEnd: f.lineEnd,
      category: f.category,
      recommendation: f.recommendation,
      confidence: f.confidence,
    }));

    return {
      id: runId,
      reviewId: `${fixture.manifest.fixture_id}-review`,
      reviewer: run.reviewer,
      status: run.status,
      summary: run.summary,
      errorMessage: run.status === "failed" ? "Simulated reviewer failure (benchmark fixture)." : null,
      providerMetadata: null,
      startedAt: null,
      completedAt: null,
      findings,
    };
  });
}

/** Every `Finding` across every reviewer run — what the deterministic verdict floor (`@/domain/verdict`) is computed from in production. */
export function allFindingsFromFixture(fixture: LoadedFixture): Finding[] {
  return buildReviewerRunsFromFixture(fixture).flatMap((run) => run.findings);
}
