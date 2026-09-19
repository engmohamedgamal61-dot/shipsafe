import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BENCHMARK_ROOT, loadFixture, type LoadedFixture } from "../load-fixtures";
import { currentBenchmarkVersions } from "../run-metadata";
import { producedFindingSchema, reviewerResultSchema, scoreFixture, type ProducedFinding } from "../scorer";
import { buildBaselineReport, renderBaselineMarkdown, writeBaselineArtifacts, COMPATIBILITY_BASELINE_NOTE } from "./report";
import type { BaselineFixtureRun } from "./run";

const accessControlVulnerable = loadFixture(
  path.join(BENCHMARK_ROOT, "access-control", "01-idor-service-role-no-owner-check"),
);
const accessControlSafe = loadFixture(
  path.join(BENCHMARK_ROOT, "access-control", "02-fp-trap-service-role-in-trusted-worker"),
);

function finding(overrides: Partial<ProducedFinding>): ProducedFinding {
  return producedFindingSchema.parse({
    category: "access-control.idor",
    severity: "P0",
    confidence: "high",
    file: "route.ts",
    lineStart: 8,
    lineEnd: 14,
    evidence: "const supabase = createServiceSupabaseClient();",
    ...overrides,
  });
}

function metadata() {
  return {
    provider: "anthropic",
    model: "claude-sonnet-5",
    maxTokens: 4096,
    concurrency: 1,
    timeoutMs: 30_000,
    versions: currentBenchmarkVersions(),
    runTimestamp: "2026-09-19T00:00:00.000Z",
  };
}

function scoredRun(fixture: LoadedFixture, findings: ProducedFinding[], summary = "summary"): BaselineFixtureRun {
  const score = scoreFixture(fixture, reviewerResultSchema.parse({ findings }));
  return {
    fixtureId: fixture.manifest.fixture_id,
    domain: fixture.manifest.domain,
    tags: fixture.manifest.tags,
    fixtureDir: fixture.fixtureDir,
    outcome: {
      status: "scored",
      score,
      rawSummary: summary,
      metadata: { provider: "anthropic", model: "claude-sonnet-5", requestId: "req-1", inputTokens: 500, outputTokens: 100, latencyMs: 1200, attempt: 1 },
    },
  };
}

function fixturesById(fixtures: LoadedFixture[]): Map<string, LoadedFixture> {
  return new Map(fixtures.map((f) => [f.manifest.fixture_id, f]));
}

describe("buildBaselineReport", () => {
  it("carries the compatibility-baseline note verbatim", () => {
    const report = buildBaselineReport([], metadata(), new Map());
    expect(report.note).toBe(COMPATIBILITY_BASELINE_NOTE);
    expect(report.isCompatibilityBaseline).toBe(true);
  });

  it("builds a full fixture report for a scored, passing fixture", () => {
    const run = scoredRun(accessControlVulnerable, [finding({})]);
    const report = buildBaselineReport([run], metadata(), fixturesById([accessControlVulnerable]));

    expect(report.fixtures).toHaveLength(1);
    const [fixtureReport] = report.fixtures;
    expect(fixtureReport.status).toBe("scored");
    expect(fixtureReport.passed).toBe(true);
    expect(fixtureReport.findings).toHaveLength(1);
    expect(fixtureReport.findings[0]?.classification).toBe("matched_required");
    expect(fixtureReport.findings[0]?.evidence).toBe("const supabase = createServiceSupabaseClient();");
    expect(fixtureReport.failureReasons).toEqual([]);
    expect(report.suite.fixturesRun).toBe(1);
    expect(report.fixturesWithProviderOrAdapterFailure).toEqual([]);
  });

  it("records a provider_failure fixture without a score, tagged 'provider/runtime failure'", () => {
    const run: BaselineFixtureRun = {
      fixtureId: "access-control-01-idor-service-role-no-owner-check",
      domain: "access-control",
      tags: ["vulnerable"],
      fixtureDir: accessControlVulnerable.fixtureDir,
      outcome: { status: "provider_failure", errorMessage: "Anthropic request failed: timeout" },
    };
    const report = buildBaselineReport([run], metadata(), fixturesById([accessControlVulnerable]));

    const [fixtureReport] = report.fixtures;
    expect(fixtureReport.status).toBe("provider_failure");
    expect(fixtureReport.passed).toBeNull();
    expect(fixtureReport.failureReasons).toEqual(["provider/runtime failure"]);
    expect(report.fixturesWithProviderOrAdapterFailure).toEqual([run.fixtureId]);
    // A failed fixture contributes nothing to suite aggregation — it never produced a FixtureScore.
    expect(report.suite.fixturesRun).toBe(0);
  });

  it("aggregates safe-code false-positive rate via extraMetrics using only actually-scored fixtures", () => {
    const safeDirty = scoredRun(accessControlSafe, [finding({ file: "worker.ts", lineStart: 15, lineEnd: 20 })]);
    const report = buildBaselineReport([safeDirty], metadata(), fixturesById([accessControlSafe]));
    expect(report.extraMetrics.safeCodeFalsePositiveRate).toBe(1);
  });

  it("computes failure reasons per fixture via analyzeFixtureFailure", () => {
    const missed = scoredRun(accessControlVulnerable, []);
    const report = buildBaselineReport([missed], metadata(), fixturesById([accessControlVulnerable]));
    expect(report.fixtures[0]?.failureReasons).toContain("missed vulnerability");
  });
});

describe("renderBaselineMarkdown", () => {
  it("includes the exact required compatibility-baseline sentence", () => {
    const report = buildBaselineReport([], metadata(), new Map());
    const markdown = renderBaselineMarkdown(report);
    expect(markdown).toContain(COMPATIBILITY_BASELINE_NOTE);
  });

  it("renders a per-fixture table row and a detail section for a scored fixture", () => {
    const run = scoredRun(accessControlVulnerable, [finding({})]);
    const report = buildBaselineReport([run], metadata(), fixturesById([accessControlVulnerable]));
    const markdown = renderBaselineMarkdown(report);
    expect(markdown).toContain(accessControlVulnerable.manifest.fixture_id);
    expect(markdown).toContain("matched_required");
  });

  it("renders an error message for a provider-failure fixture instead of a findings table", () => {
    const run: BaselineFixtureRun = {
      fixtureId: accessControlVulnerable.manifest.fixture_id,
      domain: "access-control",
      tags: ["vulnerable"],
      fixtureDir: accessControlVulnerable.fixtureDir,
      outcome: { status: "provider_failure", errorMessage: "boom" },
    };
    const report = buildBaselineReport([run], metadata(), fixturesById([accessControlVulnerable]));
    const markdown = renderBaselineMarkdown(report);
    expect(markdown).toContain("provider_failure");
    expect(markdown).toContain("boom");
  });

  it("renders 'No failures of any kind' when every fixture passes clean", () => {
    const run = scoredRun(accessControlVulnerable, [finding({})]);
    const report = buildBaselineReport([run], metadata(), fixturesById([accessControlVulnerable]));
    const markdown = renderBaselineMarkdown(report);
    expect(markdown).toContain("No failures of any kind were observed");
  });
});

describe("writeBaselineArtifacts", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("writes both a JSON report and a markdown report to the expected relative paths", () => {
    dir = mkdtempSync(path.join(tmpdir(), "shipsafe-baseline-test-"));
    const run = scoredRun(accessControlVulnerable, [finding({})]);
    const report = buildBaselineReport([run], metadata(), fixturesById([accessControlVulnerable]));

    const { jsonPath, markdownPath } = writeBaselineArtifacts(report, dir);

    expect(jsonPath).toBe(path.join(dir, "artifacts", "security-benchmark", "current-baseline.json"));
    expect(markdownPath).toBe(path.join(dir, "docs", "agents", "security-baseline-current.md"));

    const json = JSON.parse(readFileSync(jsonPath, "utf8")) as { note: string };
    expect(json.note).toBe(COMPATIBILITY_BASELINE_NOTE);

    const markdown = readFileSync(markdownPath, "utf8");
    expect(markdown).toContain(COMPATIBILITY_BASELINE_NOTE);
  });
});
