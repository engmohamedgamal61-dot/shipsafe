import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ProviderExecutionMetadata } from "@/domain/types";
import type { BenchmarkRunMetadata } from "../run-metadata";
import { aggregateScores, type JudgeFixtureScore, type SuiteMetrics } from "../scorer";
import { analyzeFixtureFailure, type FailureSymptom } from "./failure-analysis";
import { computeBaselineExtraMetrics, type BaselineExtraMetrics } from "./metrics";
import type { BaselineFixtureRun } from "./run";

export const COMPATIBILITY_BASELINE_NOTE = "This is a compatibility baseline of the CURRENT production Release Judge, measured as-shipped.";

export interface BaselineFixtureReport {
  fixtureId: string;
  domain: string;
  tags: string[];
  status: "scored" | "provider_failure";
  passed: boolean | null;
  actualVerdict: string | null;
  expectedVerdict: string | null;
  deterministicFloor: string | null;
  failureSymptoms: FailureSymptom[];
  hallucinatedTerms: string[];
  groundingIssues: string[];
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  errorMessage: string | null;
  rawSummary: string | null;
}

export interface BaselineReport {
  isCompatibilityBaseline: true;
  note: string;
  metadata: BenchmarkRunMetadata;
  fixtures: BaselineFixtureReport[];
  suite: SuiteMetrics;
  extraMetrics: BaselineExtraMetrics;
  fixturesWithProviderFailure: string[];
}

export function buildBaselineReport(runs: readonly BaselineFixtureRun[], metadata: BenchmarkRunMetadata): BaselineReport {
  const scores: JudgeFixtureScore[] = [];
  const metadataList: ProviderExecutionMetadata[] = [];
  const failedProvider: string[] = [];

  const fixtureReports: BaselineFixtureReport[] = runs.map((run) => {
    if (run.outcome.status === "provider_failure") {
      failedProvider.push(run.fixtureId);
      return {
        fixtureId: run.fixtureId,
        domain: run.domain,
        tags: run.tags,
        status: "provider_failure",
        passed: null,
        actualVerdict: null,
        expectedVerdict: null,
        deterministicFloor: null,
        failureSymptoms: ["provider/runtime failure"],
        hallucinatedTerms: [],
        groundingIssues: [],
        latencyMs: null,
        inputTokens: null,
        outputTokens: null,
        errorMessage: run.outcome.errorMessage,
        rawSummary: null,
      };
    }

    const { score, rawSummary, metadata: runMetadata } = run.outcome;
    scores.push(score);
    metadataList.push(runMetadata);

    return {
      fixtureId: run.fixtureId,
      domain: run.domain,
      tags: run.tags,
      status: "scored",
      passed: score.passed,
      actualVerdict: score.actualVerdict,
      expectedVerdict: score.expectedVerdict,
      deterministicFloor: score.deterministicFloor,
      failureSymptoms: analyzeFixtureFailure(score),
      hallucinatedTerms: score.hallucinatedTerms,
      groundingIssues: score.groundingIssues.map((g) => `${g.kind}: ${g.detail}`),
      latencyMs: runMetadata.latencyMs,
      inputTokens: runMetadata.inputTokens,
      outputTokens: runMetadata.outputTokens,
      errorMessage: null,
      rawSummary,
    };
  });

  return {
    isCompatibilityBaseline: true,
    note: COMPATIBILITY_BASELINE_NOTE,
    metadata,
    fixtures: fixtureReports,
    suite: aggregateScores(scores),
    extraMetrics: computeBaselineExtraMetrics(metadataList),
    fixturesWithProviderFailure: failedProvider,
  };
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function renderBaselineMarkdown(report: BaselineReport): string {
  const lines: string[] = [];
  lines.push("# Release Judge — Current Production Compatibility Baseline");
  lines.push("");
  lines.push(`**${report.note}**`);
  lines.push("");
  lines.push(
    "This report measures `src/server/review-engine/providers/judge-provider.ts`'s `AnthropicJudgeProvider` exactly as it exists today, against the 10 fixtures under `tests/release-judge-benchmarks/`. No prompt, provider, orchestrator, or verdict-floor change was made based on this run's results.",
  );
  lines.push("");

  lines.push("## Run metadata (reproducibility)");
  lines.push("");
  lines.push("| Field | Value |");
  lines.push("|---|---|");
  lines.push(`| Provider | \`${report.metadata.provider}\` |`);
  lines.push(`| Model | \`${report.metadata.model}\` |`);
  lines.push(`| Max tokens | ${report.metadata.maxTokens ?? "(unset)"} |`);
  lines.push(`| Request timeout | ${report.metadata.timeoutMs} ms |`);
  lines.push(`| Concurrency | ${report.metadata.concurrency} (sequential) |`);
  lines.push(`| Release Judge benchmark schema version | \`${report.metadata.versions.releaseJudgeBenchmarkSchemaVersion}\` |`);
  lines.push(`| Release Judge benchmark dataset version | \`${report.metadata.versions.releaseJudgeBenchmarkDatasetVersion}\` |`);
  lines.push(`| Release Judge prompt version | \`${report.metadata.versions.releaseJudgePromptVersion}\` |`);
  lines.push(`| Run timestamp | ${report.metadata.runTimestamp} |`);
  lines.push("");

  lines.push("## Methodology");
  lines.push("");
  lines.push("- Each fixture is a set of SIMULATED specialist `ReviewerRun`s (never raw code/diff) — see `baseline/context.ts`.");
  lines.push("- The unmodified production `ReleaseJudgeAgent` (wrapping the real `AnthropicJudgeProvider`) is invoked directly with those `ReviewerRun[]` — `ReviewOrchestrator` (and its `checkRequiredReviewers`/`applyVerdictFloor` gating) is NOT invoked, so this measures the judge's own raw behavior, not the system-level guaranteed outcome.");
  lines.push("- The deterministic floor (`@/domain/verdict`'s `minimumVerdictFor`) is computed from each fixture's findings via the real, unmodified domain function and reported alongside the judge's raw verdict for every fixture, never reimplemented independently.");
  lines.push("- A one-retry policy mirroring `ReviewOrchestrator.withRetry` is reproduced locally.");
  lines.push("- Fixtures ran sequentially (concurrency 1), each independently.");
  lines.push("- `failed-reviewer-01` is a raw-judge-only adversarial probe: production's unmodified `checkRequiredReviewers` blocks before the judge is ever consulted when required-reviewer coverage is incomplete, so this fixture's result is recorded but EXCLUDED from every production-facing metric (verdict accuracy, blocking-defect recall, missed-blocker rate, false-block rate) — see `scorer.ts`'s `countsTowardProductionFacingMetrics` and the separate `rawJudgeFailedReviewerHandlingRate`.");
  lines.push("");

  lines.push("## Aggregate metrics");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|---|---|");
  lines.push(`| Fixtures run | ${report.suite.fixturesRun} |`);
  lines.push(`| Production-facing fixtures (excludes raw-judge-only probes) | ${report.suite.productionFacingFixturesRun} |`);
  lines.push(`| Fixtures passed | ${report.suite.fixturesPassed} |`);
  lines.push(`| Verdict accuracy (production-facing) | ${pct(report.suite.verdictAccuracy)} |`);
  lines.push(`| Blocking-defect recall (production-facing) | ${pct(report.suite.blockingDefectRecall)} |`);
  lines.push(`| False-block rate (production-facing) | ${pct(report.suite.falseBlockRate)} |`);
  lines.push(`| Missed-blocker rate (production-facing) | ${pct(report.suite.missedBlockerRate)} |`);
  lines.push(`| Duplicate-risk inflation rate | ${pct(report.suite.duplicateRiskInflationRate)} |`);
  lines.push(`| Low-confidence over-escalation rate | ${pct(report.suite.lowConfidenceOverescalationRate)} |`);
  lines.push(`| Raw-judge-only failed-reviewer handling rate (NOT production-facing — see note below) | ${pct(report.suite.rawJudgeFailedReviewerHandlingRate)} |`);
  lines.push(`| Severity-floor compliance rate | ${pct(report.suite.severityFloorComplianceRate)} |`);
  lines.push(`| Rationale grounding accuracy | ${pct(report.suite.rationaleGroundingAccuracy)} |`);
  lines.push(`| Hallucinated-finding rate | ${pct(report.suite.hallucinatedFindingRate)} |`);
  lines.push(`| Average latency | ${report.extraMetrics.averageLatencyMs === null ? "n/a" : `${report.extraMetrics.averageLatencyMs.toFixed(0)} ms`} |`);
  lines.push(
    `| Total token usage | ${report.extraMetrics.totalInputTokens === null ? "n/a" : `${report.extraMetrics.totalInputTokens} in / ${report.extraMetrics.totalOutputTokens} out`} |`,
  );
  lines.push("");

  lines.push("## Per-fixture results");
  lines.push("");
  lines.push("| Fixture | Domain | Tags | Status | Pass | Actual verdict | Expected verdict | Floor | Failure symptoms |");
  lines.push("|---|---|---|---|---|---|---|---|---|");
  for (const f of report.fixtures) {
    const passText = f.passed === null ? "—" : f.passed ? "✅" : "❌";
    lines.push(
      `| \`${f.fixtureId}\` | ${f.domain} | ${f.tags.join(", ")} | ${f.status} | ${passText} | ${f.actualVerdict ?? "—"} | ${f.expectedVerdict ?? "—"} | ${f.deterministicFloor ?? "—"} | ${f.failureSymptoms.join(", ") || "—"} |`,
    );
  }
  lines.push("");

  for (const f of report.fixtures) {
    lines.push(`### \`${f.fixtureId}\``);
    lines.push("");
    if (f.status !== "scored") {
      lines.push(`**${f.status}**: ${f.errorMessage}`);
      lines.push("");
      continue;
    }
    lines.push(f.rawSummary ? `Judge summary (verbatim): ${f.rawSummary}` : "(no summary)");
    lines.push("");
    lines.push(`Actual: ${f.actualVerdict} · Expected: ${f.expectedVerdict} · Deterministic floor: ${f.deterministicFloor} · Passed: ${f.passed}`);
    lines.push(`Latency: ${f.latencyMs ?? "n/a"} ms · Tokens: ${f.inputTokens ?? "n/a"} in / ${f.outputTokens ?? "n/a"} out`);
    if (f.hallucinatedTerms.length > 0) lines.push(`Hallucinated terms found: ${f.hallucinatedTerms.join(", ")}`);
    if (f.groundingIssues.length > 0) lines.push(`Grounding issues: ${f.groundingIssues.join("; ")}`);
    lines.push("");
  }

  lines.push("## Failure pattern summary");
  lines.push("");
  const symptomCounts = new Map<string, number>();
  for (const f of report.fixtures) {
    for (const symptom of f.failureSymptoms) symptomCounts.set(symptom, (symptomCounts.get(symptom) ?? 0) + 1);
  }
  if (symptomCounts.size === 0) {
    lines.push("No failure symptoms of any kind were observed across the 10 fixtures.");
  } else {
    lines.push("| Failure symptom | Fixture count |");
    lines.push("|---|---|");
    for (const [symptom, count] of [...symptomCounts.entries()].sort((a, b) => b[1] - a[1])) {
      lines.push(`| ${symptom} | ${count} |`);
    }
  }
  lines.push("");

  if (report.fixturesWithProviderFailure.length > 0) {
    lines.push("## Provider failures");
    lines.push("");
    lines.push(`${report.fixturesWithProviderFailure.length} fixture(s) never reached scoring: ${report.fixturesWithProviderFailure.map((id) => `\`${id}\``).join(", ")}.`);
    lines.push("");
  }

  return lines.join("\n");
}

export function writeBaselineArtifacts(report: BaselineReport, repoRoot: string): { jsonPath: string; markdownPath: string } {
  const jsonPath = path.join(repoRoot, "artifacts", "release-judge-benchmark", "current-baseline.json");
  const markdownPath = path.join(repoRoot, "docs", "agents", "release-judge-baseline-current.md");

  mkdirSync(path.dirname(jsonPath), { recursive: true });
  mkdirSync(path.dirname(markdownPath), { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(markdownPath, `${renderBaselineMarkdown(report)}\n`, "utf8");

  return { jsonPath, markdownPath };
}
