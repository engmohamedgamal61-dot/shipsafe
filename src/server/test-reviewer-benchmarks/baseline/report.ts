import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { BenchmarkRunMetadata } from "../run-metadata";
import { aggregateScores, type FixtureScore, type SuiteMetrics } from "../scorer";
import type { LoadedFixture } from "../load-fixtures";
import { analyzeFixtureFailure, type FailureReason } from "./failure-analysis";
import { computeBaselineExtraMetrics, type BaselineExtraMetrics, type ScoredFixtureRun } from "./metrics";
import type { BaselineFixtureRun } from "./run";

export const COMPATIBILITY_BASELINE_NOTE = "This is a compatibility baseline of the CURRENT production Test Reviewer, measured as-shipped.";

export interface BaselineFindingRow {
  index: number;
  category: string;
  normalizedCategory: string | undefined;
  severity: string;
  confidence: string;
  file: string | null;
  lineStart: number | null;
  lineEnd: number | null;
  matchMethod: string;
  classification: string;
  matchedId: string | null;
  evidence: string;
}

export interface BaselineFixtureReport {
  fixtureId: string;
  domain: string;
  tags: string[];
  status: "scored" | "provider_failure" | "adapter_failure";
  passed: boolean | null;
  rawScore: number | null;
  normalizedScore: number | null;
  hardFailure: boolean | null;
  requiredFindingsDetected: string[];
  requiredFindingsMissed: string[];
  findings: BaselineFindingRow[];
  failureReasons: FailureReason[];
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
  fixturesWithProviderOrAdapterFailure: string[];
}

function findingRow(c: FixtureScore["allFindings"][number], index: number): BaselineFindingRow {
  return {
    index,
    category: c.finding.category,
    normalizedCategory: c.normalizedCategory,
    severity: c.finding.severity,
    confidence: c.finding.confidence,
    file: c.finding.file,
    lineStart: c.finding.lineStart,
    lineEnd: c.finding.lineEnd,
    matchMethod: c.matchMethod,
    classification: c.classification,
    matchedId: c.matchedId,
    evidence: c.finding.evidence,
  };
}

export function buildBaselineReport(
  runs: readonly BaselineFixtureRun[],
  metadata: BenchmarkRunMetadata,
  fixturesById: ReadonlyMap<string, LoadedFixture>,
): BaselineReport {
  const scoredRuns: ScoredFixtureRun[] = [];
  const scores: FixtureScore[] = [];
  const failedProviderOrAdapter: string[] = [];

  const fixtureReports: BaselineFixtureReport[] = runs.map((run) => {
    if (run.outcome.status === "provider_failure") {
      failedProviderOrAdapter.push(run.fixtureId);
      return {
        fixtureId: run.fixtureId,
        domain: run.domain,
        tags: run.tags,
        status: "provider_failure",
        passed: null,
        rawScore: null,
        normalizedScore: null,
        hardFailure: null,
        requiredFindingsDetected: [],
        requiredFindingsMissed: [],
        findings: [],
        failureReasons: ["provider/runtime failure"],
        latencyMs: null,
        inputTokens: null,
        outputTokens: null,
        errorMessage: run.outcome.errorMessage,
        rawSummary: null,
      };
    }

    if (run.outcome.status === "adapter_failure") {
      failedProviderOrAdapter.push(run.fixtureId);
      return {
        fixtureId: run.fixtureId,
        domain: run.domain,
        tags: run.tags,
        status: "adapter_failure",
        passed: null,
        rawScore: null,
        normalizedScore: null,
        hardFailure: null,
        requiredFindingsDetected: [],
        requiredFindingsMissed: [],
        findings: [],
        failureReasons: ["benchmark compatibility limitation"],
        latencyMs: run.outcome.metadata.latencyMs,
        inputTokens: run.outcome.metadata.inputTokens,
        outputTokens: run.outcome.metadata.outputTokens,
        errorMessage: run.outcome.errorMessage,
        rawSummary: null,
      };
    }

    const { score, rawSummary, metadata: runMetadata } = run.outcome;
    const fixture = fixturesById.get(run.fixtureId);
    if (fixture) scoredRuns.push({ fixture, score, metadata: runMetadata });
    scores.push(score);

    return {
      fixtureId: run.fixtureId,
      domain: run.domain,
      tags: run.tags,
      status: "scored",
      passed: score.passed,
      rawScore: score.rawScore,
      normalizedScore: score.normalizedScore,
      hardFailure: score.hardFailure,
      requiredFindingsDetected: score.requiredFindingsDetected,
      requiredFindingsMissed: score.requiredFindingsMissed,
      findings: score.allFindings.map((c, index) => findingRow(c, index)),
      failureReasons: fixture ? analyzeFixtureFailure(fixture, score) : [],
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
    extraMetrics: computeBaselineExtraMetrics(scoredRuns),
    fixturesWithProviderOrAdapterFailure: failedProviderOrAdapter,
  };
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function renderBaselineMarkdown(report: BaselineReport): string {
  const lines: string[] = [];
  lines.push("# Test Reviewer — Current Production Compatibility Baseline");
  lines.push("");
  lines.push(`**${report.note}**`);
  lines.push("");
  lines.push(
    "This report measures `src/server/review-engine/agents/test-reviewer.ts` exactly as it exists today, against the 10 fixtures under `tests/test-reviewer-benchmarks/`. No prompt, provider, or scoring change was made based on this run's results.",
  );
  lines.push("");

  lines.push("## Run metadata (reproducibility)");
  lines.push("");
  lines.push("| Field | Value |");
  lines.push("|---|---|");
  lines.push(`| Provider | \`${report.metadata.provider}\` |`);
  lines.push(`| Model | \`${report.metadata.model}\` |`);
  lines.push(`| Max tokens per reviewer | ${report.metadata.maxTokens ?? "(unset)"} |`);
  lines.push(`| Request timeout | ${report.metadata.timeoutMs} ms |`);
  lines.push(`| Concurrency | ${report.metadata.concurrency} (sequential) |`);
  lines.push(`| Temperature | not set by \`AnthropicProvider\` (API default) |`);
  lines.push(`| Thinking mode | not enabled by \`AnthropicProvider\` |`);
  lines.push(`| Test Reviewer benchmark schema version | \`${report.metadata.versions.testReviewerBenchmarkSchemaVersion}\` |`);
  lines.push(`| Test Reviewer benchmark dataset version | \`${report.metadata.versions.testReviewerBenchmarkDatasetVersion}\` |`);
  lines.push(`| Test Reviewer prompt version | \`${report.metadata.versions.testReviewerPromptVersion}\` |`);
  lines.push(`| Run timestamp | ${report.metadata.runTimestamp} |`);
  lines.push("");

  lines.push("## Methodology");
  lines.push("");
  lines.push("- Each fixture's full source file(s) are wrapped in a synthetic \"new file\" unified diff (every line a `+` addition, numbered from 1) — see `baseline/context.ts`.");
  lines.push("- The unmodified production `TestReviewerAgent` + `AnthropicProvider` classes are invoked directly — this harness never re-implements reviewer logic.");
  lines.push("- `ReviewOrchestrator`'s other four specialist reviewers and Release Judge are NOT invoked — only the Test Reviewer is graded.");
  lines.push("- A one-retry policy mirroring `ReviewOrchestrator.withRetry` is reproduced locally.");
  lines.push("- Fixtures ran sequentially (concurrency 1), each independently.");
  lines.push("");

  lines.push("## Aggregate metrics");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|---|---|");
  lines.push(`| Fixtures run | ${report.suite.fixturesRun} |`);
  lines.push(`| Fixtures passed | ${report.suite.fixturesPassed} |`);
  lines.push(`| Fixtures with a hard failure | ${report.suite.fixturesFailed} |`);
  lines.push(`| Precision | ${pct(report.suite.precision)} |`);
  lines.push(`| Recall | ${pct(report.suite.recall)} |`);
  lines.push(`| P0 recall | ${pct(report.suite.p0Recall)} |`);
  lines.push(`| P1 recall | ${pct(report.suite.p1Recall)} |`);
  lines.push(`| Safe-code false-positive rate | ${pct(report.extraMetrics.safeCodeFalsePositiveRate)} |`);
  lines.push(`| Ambiguous-case overclaim rate | ${pct(report.extraMetrics.ambiguousOverclaimRate)} |`);
  lines.push(`| Hallucinated-path rate | ${pct(report.suite.hallucinationRate)} |`);
  lines.push(`| Fabricated-evidence rate | ${pct(report.suite.fabricatedEvidenceRate)} |`);
  lines.push(`| Duplicate rate | ${pct(report.suite.duplicateRate)} |`);
  lines.push(`| Severity accuracy | ${pct(report.suite.severityAccuracyRate)} |`);
  lines.push(`| Category accuracy | ${pct(report.suite.categoryAccuracyRate)} |`);
  lines.push(
    `| Confidence calibration | high ${pct(report.suite.confidenceCalibration.high.rate)} (n=${report.suite.confidenceCalibration.high.total}) · medium ${pct(report.suite.confidenceCalibration.medium.rate)} (n=${report.suite.confidenceCalibration.medium.total}) · low ${pct(report.suite.confidenceCalibration.low.rate)} (n=${report.suite.confidenceCalibration.low.total}) |`,
  );
  lines.push(`| Average latency | ${report.extraMetrics.averageLatencyMs === null ? "n/a" : `${report.extraMetrics.averageLatencyMs.toFixed(0)} ms`} |`);
  lines.push(
    `| Total token usage | ${report.extraMetrics.totalInputTokens === null ? "n/a" : `${report.extraMetrics.totalInputTokens} in / ${report.extraMetrics.totalOutputTokens} out`} |`,
  );
  lines.push("");

  lines.push("## Per-fixture results");
  lines.push("");
  lines.push("| Fixture | Domain | Tags | Status | Pass | Score | Required missed | Failure reasons |");
  lines.push("|---|---|---|---|---|---|---|---|");
  for (const f of report.fixtures) {
    const scoreText = f.normalizedScore === null ? "—" : f.normalizedScore.toFixed(2);
    const passText = f.passed === null ? "—" : f.passed ? "✅" : "❌";
    lines.push(
      `| \`${f.fixtureId}\` | ${f.domain} | ${f.tags.join(", ")} | ${f.status} | ${passText} | ${scoreText} | ${f.requiredFindingsMissed.join(", ") || "—"} | ${f.failureReasons.join(", ") || "—"} |`,
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
    lines.push(f.rawSummary ? `Summary: ${f.rawSummary}` : "(no summary)");
    lines.push("");
    lines.push(`Score: ${f.normalizedScore?.toFixed(2)} (raw ${f.rawScore}) · Passed: ${f.passed} · Hard failure: ${f.hardFailure}`);
    lines.push(`Latency: ${f.latencyMs ?? "n/a"} ms · Tokens: ${f.inputTokens ?? "n/a"} in / ${f.outputTokens ?? "n/a"} out`);
    lines.push("");
    if (f.findings.length === 0) {
      lines.push("No findings produced.");
      lines.push("");
      continue;
    }
    lines.push("| # | Category (raw → normalized) | Severity | Confidence | File:Line | Match method | Classification | Matched id |");
    lines.push("|---|---|---|---|---|---|---|---|");
    for (const row of f.findings) {
      const location = row.file ? `${row.file}${row.lineStart ? `:${row.lineStart}${row.lineEnd && row.lineEnd !== row.lineStart ? `-${row.lineEnd}` : ""}` : ""}` : "(repository-scope)";
      lines.push(
        `| ${row.index} | ${row.category}${row.normalizedCategory ? ` → ${row.normalizedCategory}` : ""} | ${row.severity} | ${row.confidence} | ${location} | ${row.matchMethod} | ${row.classification} | ${row.matchedId ?? "—"} |`,
      );
    }
    lines.push("");
    lines.push("<details><summary>Raw evidence text per finding (verbatim, for auditing hallucination/fabrication classifications)</summary>");
    lines.push("");
    for (const row of f.findings) {
      lines.push(`- **#${row.index}** (${row.classification}): ${row.evidence.trim() || "*(empty)*"}`);
    }
    lines.push("");
    lines.push("</details>");
    lines.push("");
  }

  lines.push("## Failure pattern summary");
  lines.push("");
  const reasonCounts = new Map<string, number>();
  for (const f of report.fixtures) {
    for (const reason of f.failureReasons) reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
  }
  if (reasonCounts.size === 0) {
    lines.push("No failures of any kind were observed across the 10 fixtures.");
  } else {
    lines.push("| Failure reason | Fixture count |");
    lines.push("|---|---|");
    for (const [reason, count] of [...reasonCounts.entries()].sort((a, b) => b[1] - a[1])) {
      lines.push(`| ${reason} | ${count} |`);
    }
  }
  lines.push("");

  if (report.fixturesWithProviderOrAdapterFailure.length > 0) {
    lines.push("## Provider/adapter failures");
    lines.push("");
    lines.push(`${report.fixturesWithProviderOrAdapterFailure.length} fixture(s) never reached scoring: ${report.fixturesWithProviderOrAdapterFailure.map((id) => `\`${id}\``).join(", ")}.`);
    lines.push("");
  }

  return lines.join("\n");
}

export function writeBaselineArtifacts(report: BaselineReport, repoRoot: string): { jsonPath: string; markdownPath: string } {
  const jsonPath = path.join(repoRoot, "artifacts", "test-reviewer-benchmark", "current-baseline.json");
  const markdownPath = path.join(repoRoot, "docs", "agents", "test-reviewer-baseline-current.md");

  mkdirSync(path.dirname(jsonPath), { recursive: true });
  mkdirSync(path.dirname(markdownPath), { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(markdownPath, `${renderBaselineMarkdown(report)}\n`, "utf8");

  return { jsonPath, markdownPath };
}
