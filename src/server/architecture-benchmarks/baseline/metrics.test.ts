import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ProviderExecutionMetadata } from "@/domain/types";
import { BENCHMARK_ROOT, loadFixture } from "../load-fixtures";
import { producedFindingSchema, reviewerResultSchema, scoreFixture, type ProducedFinding } from "../scorer";
import { computeBaselineExtraMetrics, type ScoredFixtureRun } from "./metrics";

const layerBoundaries = loadFixture(path.join(BENCHMARK_ROOT, "layer-boundaries", "01-repository-imports-ui-component"));
const safeDecorator = loadFixture(path.join(BENCHMARK_ROOT, "safe", "01-caching-decorator-follows-ports-pattern"));
const ambiguous = loadFixture(path.join(BENCHMARK_ROOT, "ambiguous", "01-shared-utility-module-unclear-ownership"));

function finding(overrides: Partial<ProducedFinding>): ProducedFinding {
  return producedFindingSchema.parse({
    category: "layer-boundaries.cross-layer-import",
    severity: "P1",
    confidence: "high",
    file: "supabase-adapter.ts",
    lineStart: 2,
    lineEnd: 8,
    evidence: "",
    ...overrides,
  });
}

function metadata(overrides: Partial<ProviderExecutionMetadata> = {}): ProviderExecutionMetadata {
  return { provider: "anthropic", model: "claude-sonnet-5", requestId: null, inputTokens: 100, outputTokens: 50, latencyMs: 1000, attempt: 1, ...overrides };
}

describe("computeBaselineExtraMetrics", () => {
  it("returns 0 for safe/ambiguous rates when no such fixtures are in the run", () => {
    const runs: ScoredFixtureRun[] = [{ fixture: layerBoundaries, score: scoreFixture(layerBoundaries, reviewerResultSchema.parse({ findings: [finding({})] })), metadata: metadata() }];
    const metrics = computeBaselineExtraMetrics(runs);
    expect(metrics.safeCodeFalsePositiveRate).toBe(0);
    expect(metrics.ambiguousOverclaimRate).toBe(0);
  });

  it("computes safeCodeFalsePositiveRate over only safe/false_positive_trap fixtures", () => {
    const clean = scoreFixture(safeDecorator, reviewerResultSchema.parse({ findings: [] }));
    const dirty = scoreFixture(safeDecorator, reviewerResultSchema.parse({ findings: [finding({ file: "caching-review-repository.ts", lineStart: 8, lineEnd: 8 })] }));
    const runs: ScoredFixtureRun[] = [
      { fixture: safeDecorator, score: clean, metadata: metadata() },
      { fixture: safeDecorator, score: dirty, metadata: metadata() },
    ];
    expect(computeBaselineExtraMetrics(runs).safeCodeFalsePositiveRate).toBeCloseTo(0.5);
  });

  it("computes ambiguousOverclaimRate over only ambiguous fixtures", () => {
    const cautious = scoreFixture(ambiguous, reviewerResultSchema.parse({ findings: [] }));
    const overclaim = scoreFixture(
      ambiguous,
      reviewerResultSchema.parse({ findings: [finding({ category: "responsibility-separation.generic", confidence: "high", file: "shared-utils.ts", lineStart: 5, lineEnd: 7 })] }),
    );
    const runs: ScoredFixtureRun[] = [
      { fixture: ambiguous, score: cautious, metadata: metadata() },
      { fixture: ambiguous, score: overclaim, metadata: metadata() },
    ];
    expect(computeBaselineExtraMetrics(runs).ambiguousOverclaimRate).toBeCloseTo(0.5);
  });

  it("averages latency and sums tokens across runs, null-safe", () => {
    const score = scoreFixture(layerBoundaries, reviewerResultSchema.parse({ findings: [] }));
    const runs: ScoredFixtureRun[] = [
      { fixture: layerBoundaries, score, metadata: metadata({ latencyMs: 1000, inputTokens: 100, outputTokens: 50 }) },
      { fixture: layerBoundaries, score, metadata: metadata({ latencyMs: 2000, inputTokens: null, outputTokens: null }) },
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
