import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ProviderExecutionMetadata } from "@/domain/types";
import { BENCHMARK_ROOT, loadFixture } from "../load-fixtures";
import { producedFindingSchema, reviewerResultSchema, scoreFixture, type ProducedFinding } from "../scorer";
import { computeBaselineExtraMetrics, type ScoredFixtureRun } from "./metrics";

const accessControlVulnerable = loadFixture(
  path.join(BENCHMARK_ROOT, "access-control", "01-idor-service-role-no-owner-check"),
);
const accessControlSafe = loadFixture(
  path.join(BENCHMARK_ROOT, "access-control", "02-fp-trap-service-role-in-trusted-worker"),
);
const ambiguous = loadFixture(path.join(BENCHMARK_ROOT, "multi-tenant", "04-ambiguous-security-definer-no-callsite"));

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

function metadata(overrides: Partial<ProviderExecutionMetadata> = {}): ProviderExecutionMetadata {
  return { provider: "anthropic", model: "claude-sonnet-5", requestId: null, inputTokens: 100, outputTokens: 50, latencyMs: 1000, attempt: 1, ...overrides };
}

describe("computeBaselineExtraMetrics", () => {
  it("returns 0 (not 1) for safe/ambiguous rates when no such fixtures are in the run", () => {
    const runs: ScoredFixtureRun[] = [
      { fixture: accessControlVulnerable, score: scoreFixture(accessControlVulnerable, reviewerResultSchema.parse({ findings: [finding({})] })), metadata: metadata() },
    ];
    const metrics = computeBaselineExtraMetrics(runs);
    expect(metrics.safeCodeFalsePositiveRate).toBe(0);
    expect(metrics.ambiguousOverclaimRate).toBe(0);
  });

  it("computes safeCodeFalsePositiveRate over only safe/false_positive_trap fixtures", () => {
    const cleanSafe = scoreFixture(accessControlSafe, reviewerResultSchema.parse({ findings: [] }));
    const dirtySafe = scoreFixture(
      accessControlSafe,
      reviewerResultSchema.parse({ findings: [finding({ file: "worker.ts", lineStart: 15, lineEnd: 20 })] }),
    );
    const runs: ScoredFixtureRun[] = [
      { fixture: accessControlSafe, score: cleanSafe, metadata: metadata() },
      { fixture: accessControlSafe, score: dirtySafe, metadata: metadata() },
    ];
    expect(computeBaselineExtraMetrics(runs).safeCodeFalsePositiveRate).toBeCloseTo(0.5);
  });

  it("computes ambiguousOverclaimRate over only ambiguous fixtures", () => {
    const cautious = scoreFixture(ambiguous, reviewerResultSchema.parse({ findings: [] }));
    const overclaim = scoreFixture(
      ambiguous,
      reviewerResultSchema.parse({
        findings: [finding({ category: "multi-tenant.security-definer", confidence: "high", file: "migration.sql", lineStart: 5, lineEnd: 19 })],
      }),
    );
    const runs: ScoredFixtureRun[] = [
      { fixture: ambiguous, score: cautious, metadata: metadata() },
      { fixture: ambiguous, score: overclaim, metadata: metadata() },
    ];
    expect(computeBaselineExtraMetrics(runs).ambiguousOverclaimRate).toBeCloseTo(0.5);
  });

  it("averages latency and sums tokens across runs", () => {
    const score = scoreFixture(accessControlVulnerable, reviewerResultSchema.parse({ findings: [] }));
    const runs: ScoredFixtureRun[] = [
      { fixture: accessControlVulnerable, score, metadata: metadata({ latencyMs: 1000, inputTokens: 100, outputTokens: 50 }) },
      { fixture: accessControlVulnerable, score, metadata: metadata({ latencyMs: 2000, inputTokens: 200, outputTokens: 100 }) },
    ];
    const metrics = computeBaselineExtraMetrics(runs);
    expect(metrics.averageLatencyMs).toBe(1500);
    expect(metrics.totalInputTokens).toBe(300);
    expect(metrics.totalOutputTokens).toBe(150);
  });

  it("returns null for latency/token metrics when the run list is empty", () => {
    const metrics = computeBaselineExtraMetrics([]);
    expect(metrics.averageLatencyMs).toBeNull();
    expect(metrics.totalInputTokens).toBeNull();
    expect(metrics.totalOutputTokens).toBeNull();
  });

  it("sums tokens as null-safe when some runs have null token counts (e.g. a provider that doesn't report usage)", () => {
    const score = scoreFixture(accessControlVulnerable, reviewerResultSchema.parse({ findings: [] }));
    const runs: ScoredFixtureRun[] = [
      { fixture: accessControlVulnerable, score, metadata: metadata({ inputTokens: null, outputTokens: null }) },
      { fixture: accessControlVulnerable, score, metadata: metadata({ inputTokens: 200, outputTokens: 100 }) },
    ];
    const metrics = computeBaselineExtraMetrics(runs);
    expect(metrics.totalInputTokens).toBe(200);
    expect(metrics.totalOutputTokens).toBe(100);
  });
});
