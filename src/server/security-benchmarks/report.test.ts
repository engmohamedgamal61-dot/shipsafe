import path from "node:path";
import { describe, expect, it } from "vitest";
import { BENCHMARK_ROOT, loadFixture } from "./load-fixtures";
import { buildBenchmarkReport } from "./report";
import { currentBenchmarkVersions } from "./run-metadata";
import { producedFindingSchema, reviewerResultSchema, scoreFixture, type ProducedFinding } from "./scorer";

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
    evidence: "",
    ...overrides,
  });
}

function metadata() {
  return {
    provider: "anthropic",
    model: "claude-sonnet-5",
    concurrency: 4,
    timeoutMs: 60_000,
    versions: currentBenchmarkVersions(),
    runTimestamp: "2026-09-19T00:00:00.000Z",
  };
}

describe("buildBenchmarkReport (plan §8's report header, Tasks 3/4/5/6)", () => {
  it("carries the run metadata through unchanged", () => {
    const report = buildBenchmarkReport(
      [scoreFixture(accessControlVulnerable, reviewerResultSchema.parse({ findings: [finding({})] }))],
      metadata(),
    );
    expect(report.metadata).toEqual(metadata());
  });

  it("includes suite metrics and deferred metrics, the latter always not_measurable in this pass", () => {
    const perfect = scoreFixture(accessControlVulnerable, reviewerResultSchema.parse({ findings: [finding({})] }));
    const safePass = scoreFixture(accessControlSafe, reviewerResultSchema.parse({ findings: [] }));
    const report = buildBenchmarkReport([perfect, safePass], metadata());

    expect(report.suite.fixturesRun).toBe(2);
    expect(report.deferredMetrics.exploitPathValidity.status).toBe("not_measurable");
    expect(report.deferredMetrics.standardsMappingAccuracy.status).toBe("not_measurable");
    expect(report.deferredMetrics.remediationQuality.status).toBe("not_measurable");
  });

  it("flattens a run-wide compatibility report tagged with each row's fixtureId", () => {
    const perfect = scoreFixture(accessControlVulnerable, reviewerResultSchema.parse({ findings: [finding({})] }));
    const falsePositive = scoreFixture(
      accessControlSafe,
      reviewerResultSchema.parse({ findings: [finding({ file: "worker.ts", lineStart: 15, lineEnd: 20 })] }),
    );
    const report = buildBenchmarkReport([perfect, falsePositive], metadata());

    expect(report.compatibility).toHaveLength(2);
    expect(report.compatibility.map((row) => row.fixtureId)).toEqual([perfect.fixtureId, falsePositive.fixtureId]);
  });

  it("produces an empty compatibility report and zero-fixture suite metrics for an empty run", () => {
    const report = buildBenchmarkReport([], metadata());
    expect(report.compatibility).toEqual([]);
    expect(report.suite.fixturesRun).toBe(0);
  });
});
