import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BENCHMARK_ROOT, loadFixture, type LoadedFixture } from "../load-fixtures";
import { currentBenchmarkVersions } from "../run-metadata";
import { producedFindingSchema, reviewerResultSchema, scoreFixture, type ProducedFinding } from "../scorer";
import { buildBaselineReport, COMPATIBILITY_BASELINE_NOTE, renderBaselineMarkdown, writeBaselineArtifacts } from "./report";
import type { BaselineFixtureRun } from "./run";

const offByOne = loadFixture(path.join(BENCHMARK_ROOT, "correctness", "01-off-by-one-pagination"));
const safeRange = loadFixture(path.join(BENCHMARK_ROOT, "correctness", "02-safe-half-open-range"));

function finding(overrides: Partial<ProducedFinding> = {}): ProducedFinding {
  return producedFindingSchema.parse({
    category: "correctness.off-by-one",
    severity: "P1",
    confidence: "high",
    file: "paginate.ts",
    lineStart: 7,
    lineEnd: 7,
    evidence: "items.slice(start, end + 1)",
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
    outcome: { status: "scored", score, rawSummary: summary, metadata: { provider: "anthropic", model: "claude-sonnet-5", requestId: "r1", inputTokens: 500, outputTokens: 100, latencyMs: 1200, attempt: 1 } },
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
    const run = scoredRun(offByOne, [finding()]);
    const report = buildBaselineReport([run], metadata(), fixturesById([offByOne]));
    const [fixtureReport] = report.fixtures;
    expect(fixtureReport.status).toBe("scored");
    expect(fixtureReport.passed).toBe(true);
    expect(fixtureReport.findings[0]?.classification).toBe("matched_required");
    expect(fixtureReport.findings[0]?.evidence).toBe("items.slice(start, end + 1)");
  });

  it("records a provider_failure fixture without a score", () => {
    const run: BaselineFixtureRun = {
      fixtureId: offByOne.manifest.fixture_id,
      domain: "correctness",
      tags: ["buggy"],
      fixtureDir: offByOne.fixtureDir,
      outcome: { status: "provider_failure", errorMessage: "timeout" },
    };
    const report = buildBaselineReport([run], metadata(), fixturesById([offByOne]));
    expect(report.fixtures[0]?.status).toBe("provider_failure");
    expect(report.fixturesWithProviderOrAdapterFailure).toEqual([run.fixtureId]);
    expect(report.suite.fixturesRun).toBe(0);
  });

  it("aggregates safe-code false-positive rate via extraMetrics", () => {
    const safeDirty = scoredRun(safeRange, [finding({ file: "ranges.ts", lineStart: 9, lineEnd: 9 })]);
    const report = buildBaselineReport([safeDirty], metadata(), fixturesById([safeRange]));
    expect(report.extraMetrics.safeCodeFalsePositiveRate).toBe(1);
  });
});

describe("renderBaselineMarkdown", () => {
  it("includes the exact required compatibility-baseline sentence", () => {
    const markdown = renderBaselineMarkdown(buildBaselineReport([], metadata(), new Map()));
    expect(markdown).toContain(COMPATIBILITY_BASELINE_NOTE);
  });

  it("renders a per-fixture table row and category-accuracy metric", () => {
    const run = scoredRun(offByOne, [finding()]);
    const markdown = renderBaselineMarkdown(buildBaselineReport([run], metadata(), fixturesById([offByOne])));
    expect(markdown).toContain(offByOne.manifest.fixture_id);
    expect(markdown).toContain("Category accuracy");
  });
});

describe("writeBaselineArtifacts", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("writes both a JSON report and a markdown report to the expected relative paths", () => {
    dir = mkdtempSync(path.join(tmpdir(), "code-benchmark-test-"));
    const run = scoredRun(offByOne, [finding()]);
    const report = buildBaselineReport([run], metadata(), fixturesById([offByOne]));
    const { jsonPath, markdownPath } = writeBaselineArtifacts(report, dir);

    expect(jsonPath).toBe(path.join(dir, "artifacts", "code-benchmark", "current-baseline.json"));
    expect(markdownPath).toBe(path.join(dir, "docs", "agents", "code-baseline-current.md"));

    const json = JSON.parse(readFileSync(jsonPath, "utf8")) as { note: string };
    expect(json.note).toBe(COMPATIBILITY_BASELINE_NOTE);
    expect(readFileSync(markdownPath, "utf8")).toContain(COMPATIBILITY_BASELINE_NOTE);
  });
});
