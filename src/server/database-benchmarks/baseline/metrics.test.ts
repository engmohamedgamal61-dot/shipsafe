import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ProviderExecutionMetadata } from "@/domain/types";
import { BENCHMARK_ROOT, loadFixture } from "../load-fixtures";
import { producedFindingSchema, reviewerResultSchema, scoreFixture, type ProducedFinding } from "../scorer";
import { computeBaselineExtraMetrics, type ScoredFixtureRun } from "./metrics";

const missingFk = loadFixture(path.join(BENCHMARK_ROOT, "foreign-keys", "01-missing-foreign-key-reference"));
const safeMigration = loadFixture(path.join(BENCHMARK_ROOT, "safe-migration", "01-scoped-uniqueness-and-correct-cascades"));
const ambiguous = loadFixture(path.join(BENCHMARK_ROOT, "ambiguous", "01-index-build-lock-risk-unknown-table-size"));

function finding(overrides: Partial<ProducedFinding>): ProducedFinding {
  return producedFindingSchema.parse({
    category: "foreign-keys.missing-reference",
    severity: "P1",
    confidence: "high",
    file: "migration.sql",
    lineStart: 5,
    lineEnd: 5,
    evidence: "",
    ...overrides,
  });
}

function metadata(overrides: Partial<ProviderExecutionMetadata> = {}): ProviderExecutionMetadata {
  return { provider: "anthropic", model: "claude-sonnet-5", requestId: null, inputTokens: 100, outputTokens: 50, latencyMs: 1000, attempt: 1, ...overrides };
}

describe("computeBaselineExtraMetrics", () => {
  it("returns 0 for safe/ambiguous rates when no such fixtures are in the run", () => {
    const runs: ScoredFixtureRun[] = [{ fixture: missingFk, score: scoreFixture(missingFk, reviewerResultSchema.parse({ findings: [finding({})] })), metadata: metadata() }];
    const metrics = computeBaselineExtraMetrics(runs);
    expect(metrics.safeCodeFalsePositiveRate).toBe(0);
    expect(metrics.ambiguousOverclaimRate).toBe(0);
  });

  it("computes safeCodeFalsePositiveRate over only safe/false_positive_trap fixtures", () => {
    const clean = scoreFixture(safeMigration, reviewerResultSchema.parse({ findings: [] }));
    const dirty = scoreFixture(safeMigration, reviewerResultSchema.parse({ findings: [finding({ file: "migration.sql", lineStart: 9, lineEnd: 9 })] }));
    const runs: ScoredFixtureRun[] = [
      { fixture: safeMigration, score: clean, metadata: metadata() },
      { fixture: safeMigration, score: dirty, metadata: metadata() },
    ];
    expect(computeBaselineExtraMetrics(runs).safeCodeFalsePositiveRate).toBeCloseTo(0.5);
  });

  it("computes ambiguousOverclaimRate over only ambiguous fixtures", () => {
    const cautious = scoreFixture(ambiguous, reviewerResultSchema.parse({ findings: [] }));
    const overclaim = scoreFixture(
      ambiguous,
      reviewerResultSchema.parse({ findings: [finding({ category: "migration-safety.generic", confidence: "high", file: "migration.sql", lineStart: 3, lineEnd: 3 })] }),
    );
    const runs: ScoredFixtureRun[] = [
      { fixture: ambiguous, score: cautious, metadata: metadata() },
      { fixture: ambiguous, score: overclaim, metadata: metadata() },
    ];
    expect(computeBaselineExtraMetrics(runs).ambiguousOverclaimRate).toBeCloseTo(0.5);
  });

  it("averages latency and sums tokens across runs, null-safe", () => {
    const score = scoreFixture(missingFk, reviewerResultSchema.parse({ findings: [] }));
    const runs: ScoredFixtureRun[] = [
      { fixture: missingFk, score, metadata: metadata({ latencyMs: 1000, inputTokens: 100, outputTokens: 50 }) },
      { fixture: missingFk, score, metadata: metadata({ latencyMs: 2000, inputTokens: null, outputTokens: null }) },
    ];
    const metrics = computeBaselineExtraMetrics(runs);
    expect(metrics.averageLatencyMs).toBe(1500);
    expect(metrics.totalInputTokens).toBe(100);
    expect(metrics.totalOutputTokens).toBe(50);
  });

  it("returns null for latency/token metrics when the run list is empty", () => {
    const metrics = computeBaselineExtraMetrics([]);
    expect(metrics.averageLatencyMs).toBeNull();
    expect(metrics.totalInputTokens).toBeNull();
  });
});
