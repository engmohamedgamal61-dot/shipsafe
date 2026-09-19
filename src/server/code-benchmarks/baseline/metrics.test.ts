import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ProviderExecutionMetadata } from "@/domain/types";
import { BENCHMARK_ROOT, loadFixture } from "../load-fixtures";
import { producedFindingSchema, reviewerResultSchema, scoreFixture, type ProducedFinding } from "../scorer";
import { computeBaselineExtraMetrics, type ScoredFixtureRun } from "./metrics";

const offByOne = loadFixture(path.join(BENCHMARK_ROOT, "correctness", "01-off-by-one-pagination"));
const safeRange = loadFixture(path.join(BENCHMARK_ROOT, "correctness", "02-safe-half-open-range"));
const ambiguous = loadFixture(path.join(BENCHMARK_ROOT, "ambiguous", "01-unvalidated-discount-lookup"));

function finding(overrides: Partial<ProducedFinding>): ProducedFinding {
  return producedFindingSchema.parse({
    category: "correctness.off-by-one",
    severity: "P1",
    confidence: "high",
    file: "paginate.ts",
    lineStart: 7,
    lineEnd: 7,
    evidence: "",
    ...overrides,
  });
}

function metadata(overrides: Partial<ProviderExecutionMetadata> = {}): ProviderExecutionMetadata {
  return { provider: "anthropic", model: "claude-sonnet-5", requestId: null, inputTokens: 100, outputTokens: 50, latencyMs: 1000, attempt: 1, ...overrides };
}

describe("computeBaselineExtraMetrics", () => {
  it("returns 0 for safe/ambiguous rates when no such fixtures are in the run", () => {
    const runs: ScoredFixtureRun[] = [{ fixture: offByOne, score: scoreFixture(offByOne, reviewerResultSchema.parse({ findings: [finding({})] })), metadata: metadata() }];
    const metrics = computeBaselineExtraMetrics(runs);
    expect(metrics.safeCodeFalsePositiveRate).toBe(0);
    expect(metrics.ambiguousOverclaimRate).toBe(0);
  });

  it("computes safeCodeFalsePositiveRate over only safe/false_positive_trap fixtures", () => {
    const clean = scoreFixture(safeRange, reviewerResultSchema.parse({ findings: [] }));
    const dirty = scoreFixture(safeRange, reviewerResultSchema.parse({ findings: [finding({ file: "ranges.ts", lineStart: 9, lineEnd: 9 })] }));
    const runs: ScoredFixtureRun[] = [
      { fixture: safeRange, score: clean, metadata: metadata() },
      { fixture: safeRange, score: dirty, metadata: metadata() },
    ];
    expect(computeBaselineExtraMetrics(runs).safeCodeFalsePositiveRate).toBeCloseTo(0.5);
  });

  it("computes ambiguousOverclaimRate over only ambiguous fixtures", () => {
    const cautious = scoreFixture(ambiguous, reviewerResultSchema.parse({ findings: [] }));
    const overclaim = scoreFixture(
      ambiguous,
      reviewerResultSchema.parse({ findings: [finding({ category: "correctness.generic", confidence: "high", file: "apply-discount.ts", lineStart: 11, lineEnd: 12 })] }),
    );
    const runs: ScoredFixtureRun[] = [
      { fixture: ambiguous, score: cautious, metadata: metadata() },
      { fixture: ambiguous, score: overclaim, metadata: metadata() },
    ];
    expect(computeBaselineExtraMetrics(runs).ambiguousOverclaimRate).toBeCloseTo(0.5);
  });

  it("averages latency and sums tokens across runs, null-safe", () => {
    const score = scoreFixture(offByOne, reviewerResultSchema.parse({ findings: [] }));
    const runs: ScoredFixtureRun[] = [
      { fixture: offByOne, score, metadata: metadata({ latencyMs: 1000, inputTokens: 100, outputTokens: 50 }) },
      { fixture: offByOne, score, metadata: metadata({ latencyMs: 2000, inputTokens: null, outputTokens: null }) },
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
