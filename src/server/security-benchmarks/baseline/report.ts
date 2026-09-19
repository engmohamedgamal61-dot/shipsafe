import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { DeferredMetricResult, DeferredMetrics } from "../deferred-metrics";
import { computeDeferredMetrics } from "../deferred-metrics";
import type { BenchmarkRunMetadata } from "../run-metadata";
import { aggregateScores, type FixtureScore, type SuiteMetrics } from "../scorer";
import type { LoadedFixture } from "../load-fixtures";
import { analyzeFixtureFailure, type FailureReason } from "./failure-analysis";
import { computeBaselineExtraMetrics, type BaselineExtraMetrics, type ScoredFixtureRun } from "./metrics";
import type { BaselineFixtureRun } from "./run";

export const COMPATIBILITY_BASELINE_NOTE =
  "This is a compatibility baseline of the CURRENT production Security Reviewer, not Security Reviewer v2.";

export interface BaselineFindingRow {
  index: number;
  category: string;
  normalizedCategory: string | undefined;
  severity: string;
  confidence: string;
  evidenceState: string | undefined;
  file: string | null;
  lineStart: number | null;
  lineEnd: number | null;
  matchMethod: string;
  classification: string;
  matchedId: string | null;
  /** The raw `description`→`evidence` text the reviewer produced — kept verbatim so a failure classification (esp. `fabricated_evidence`/`hallucinated_path`) is auditable from the report alone, never just asserted. */
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
  /** Computed only over fixtures that actually produced a score — a provider/adapter failure has no `FixtureScore` to aggregate. */
  suite: SuiteMetrics;
  extraMetrics: BaselineExtraMetrics;
  deferredMetrics: DeferredMetrics;
  fixturesWithProviderOrAdapterFailure: string[];
}

function findingRow(score: FixtureScore, index: number, c: FixtureScore["allFindings"][number]): BaselineFindingRow {
  return {
    index,
    category: c.finding.category,
    normalizedCategory: c.normalizedCategory,
    severity: c.finding.severity,
    confidence: c.finding.confidence,
    evidenceState: c.finding.evidenceState,
    file: c.finding.file,
    lineStart: c.finding.lineStart,
    lineEnd: c.finding.lineEnd,
    matchMethod: c.matchMethod,
    classification: c.classification,
    matchedId: c.matchedId,
    evidence: c.finding.evidence,
  };
}

export function buildBaselineReport(runs: readonly BaselineFixtureRun[], metadata: BenchmarkRunMetadata, fixturesById: ReadonlyMap<string, LoadedFixture>): BaselineReport {
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
    if (fixture) {
      scoredRuns.push({ fixture, score, metadata: runMetadata });
    }
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
      findings: score.allFindings.map((c, index) => findingRow(score, index, c)),
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
    deferredMetrics: computeDeferredMetrics(scores),
    fixturesWithProviderOrAdapterFailure: failedProviderOrAdapter,
  };
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/** Every branch of `DeferredMetricResult` renders today (only `"not_measurable"` exists yet), but this stays exhaustive for the day a real `"measured"` branch is implemented. */
function describeDeferredMetric(result: DeferredMetricResult): string {
  return result.status === "not_measurable" ? result.reason : `measured: ${result.value} (n=${result.sampleSize})`;
}

export function renderBaselineMarkdown(report: BaselineReport): string {
  const lines: string[] = [];
  lines.push("# Security Reviewer — Current Production Compatibility Baseline");
  lines.push("");
  lines.push(`**${report.note}**`);
  lines.push("");
  lines.push(
    "This report measures `src/server/review-engine/agents/security-reviewer.ts` (the CURRENT, shipped Security Reviewer — a short, general instruction string, not the `docs/agents/security-reviewer-v2.md` knowledge spec) exactly as it exists today, against the 10 fixtures under `tests/security-benchmarks/`. No prompt, provider, or scoring change was made based on this run's results — see the plan's Task 7 constraint.",
  );
  lines.push("");

  lines.push("## Run metadata (reproducibility, plan §8)");
  lines.push("");
  lines.push("| Field | Value |");
  lines.push("|---|---|");
  lines.push(`| Provider | \`${report.metadata.provider}\` |`);
  lines.push(`| Model | \`${report.metadata.model}\` |`);
  lines.push(`| Max tokens per reviewer | ${report.metadata.maxTokens ?? "(unset)"} |`);
  lines.push(`| Request timeout | ${report.metadata.timeoutMs} ms |`);
  lines.push(`| Concurrency | ${report.metadata.concurrency} (sequential — see Methodology) |`);
  lines.push(`| Temperature | not set by \`AnthropicProvider\` (API default) |`);
  lines.push(`| Thinking mode | not enabled by \`AnthropicProvider\` |`);
  lines.push(`| Security taxonomy version | \`${report.metadata.versions.securityTaxonomyVersion}\` |`);
  lines.push(`| Benchmark schema version | \`${report.metadata.versions.benchmarkSchemaVersion}\` |`);
  lines.push(`| Benchmark dataset version | \`${report.metadata.versions.benchmarkDatasetVersion}\` |`);
  lines.push(`| Reviewer prompt version | \`${report.metadata.versions.reviewerPromptVersion}\` |`);
  lines.push(`| Run timestamp | ${report.metadata.runTimestamp} |`);
  lines.push("");

  lines.push("## Methodology");
  lines.push("");
  lines.push(
    "- Each fixture's full source file(s) are wrapped in a synthetic \"new file\" unified diff (every line a `+` addition, numbered from 1) so the diff's line numbers exactly match the fixture's own line numbers — see `baseline/context.ts`.",
  );
  lines.push(
    "- The unmodified production `SecurityReviewerAgent` + `AnthropicProvider` classes are invoked directly (same prompt-building code, same model/token/timeout config, same known-file-hallucination guard) — this harness never re-implements reviewer logic.",
  );
  lines.push(
    "- `ReviewOrchestrator`'s other four specialist reviewers and Release Judge are NOT invoked — only the Security Reviewer is graded, and running the others would 5x+ this run's real API cost for output nobody scores.",
  );
  lines.push(
    "- A one-retry policy mirroring `ReviewOrchestrator.withRetry` (retry once, only on a `ProviderError` classified `retryable`) is reproduced locally, since that method is private to a class this harness doesn't instantiate.",
  );
  lines.push("- Fixtures ran sequentially (concurrency 1), each independently — no shared conversation or state between fixtures.");
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
  lines.push(`| Fabricated-evidence rate | ${pct(report.suite.classificationCounts.fabricated_evidence / Math.max(1, report.suite.totalProducedFindings))} |`);
  lines.push(`| Speculative-finding rate | ${pct(report.suite.speculativeRate)} |`);
  lines.push(`| Duplicate rate | ${pct(report.suite.duplicateRate)} |`);
  lines.push(`| Severity accuracy | ${pct(report.suite.severityAccuracyRate)} |`);
  lines.push(
    `| Confidence calibration | high ${pct(report.suite.confidenceCalibration.high.rate)} (n=${report.suite.confidenceCalibration.high.total}) · medium ${pct(report.suite.confidenceCalibration.medium.rate)} (n=${report.suite.confidenceCalibration.medium.total}) · low ${pct(report.suite.confidenceCalibration.low.rate)} (n=${report.suite.confidenceCalibration.low.total}) |`,
  );
  lines.push(
    `| Evidence-state measurability | ${report.suite.evidenceState.p0p1Total === 0 ? "n/a — no P0/P1 findings produced" : `${pct(report.suite.evidenceState.coverageRate)} measurable (${report.suite.evidenceState.p0p1Measurable}/${report.suite.evidenceState.p0p1Total}), ${report.suite.evidenceState.p0p1NotMeasurable} not measurable, ${report.suite.evidenceState.p0p1Violations} violation(s)`} |`,
  );
  lines.push(`| Average latency | ${report.extraMetrics.averageLatencyMs === null ? "n/a" : `${report.extraMetrics.averageLatencyMs.toFixed(0)} ms`} |`);
  lines.push(
    `| Total token usage | ${report.extraMetrics.totalInputTokens === null ? "n/a" : `${report.extraMetrics.totalInputTokens} in / ${report.extraMetrics.totalOutputTokens} out`} |`,
  );
  lines.push("");

  lines.push("### Deferred metrics (never fabricated — see plan §1/§6)");
  lines.push("");
  lines.push("| Metric | Status | Reason |");
  lines.push("|---|---|---|");
  lines.push(`| Exploit-path validity | ${report.deferredMetrics.exploitPathValidity.status} | ${describeDeferredMetric(report.deferredMetrics.exploitPathValidity)} |`);
  lines.push(
    `| Standards-mapping accuracy | ${report.deferredMetrics.standardsMappingAccuracy.status} | ${describeDeferredMetric(report.deferredMetrics.standardsMappingAccuracy)} |`,
  );
  lines.push(`| Remediation quality | ${report.deferredMetrics.remediationQuality.status} | ${describeDeferredMetric(report.deferredMetrics.remediationQuality)} |`);
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
    lines.push("| # | Category (raw → normalized) | Severity | Confidence | Evidence state | File:Line | Match method | Classification | Matched id |");
    lines.push("|---|---|---|---|---|---|---|---|---|");
    for (const row of f.findings) {
      const location = row.file ? `${row.file}${row.lineStart ? `:${row.lineStart}${row.lineEnd && row.lineEnd !== row.lineStart ? `-${row.lineEnd}` : ""}` : ""}` : "(repository-scope)";
      lines.push(
        `| ${row.index} | ${row.category}${row.normalizedCategory ? ` → ${row.normalizedCategory}` : ""} | ${row.severity} | ${row.confidence} | ${row.evidenceState ?? "(unset)"} | ${location} | ${row.matchMethod} | ${row.classification} | ${row.matchedId ?? "—"} |`,
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
    for (const reason of f.failureReasons) {
      reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
    }
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
    lines.push(
      `${report.fixturesWithProviderOrAdapterFailure.length} fixture(s) never reached scoring: ${report.fixturesWithProviderOrAdapterFailure.map((id) => `\`${id}\``).join(", ")}. See each fixture's section above for the error message.`,
    );
    lines.push("");
  }

  return lines.join("\n");
}

export function writeBaselineArtifacts(report: BaselineReport, repoRoot: string): { jsonPath: string; markdownPath: string } {
  const jsonPath = path.join(repoRoot, "artifacts", "security-benchmark", "current-baseline.json");
  const markdownPath = path.join(repoRoot, "docs", "agents", "security-baseline-current.md");

  mkdirSync(path.dirname(jsonPath), { recursive: true });
  mkdirSync(path.dirname(markdownPath), { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(markdownPath, `${renderBaselineMarkdown(report)}\n`, "utf8");

  return { jsonPath, markdownPath };
}
