import { describe, expect, it } from "vitest";
import type { ProviderExecutionMetadata } from "@/domain/types";
import { computeBaselineExtraMetrics } from "./metrics";

function metadata(overrides: Partial<ProviderExecutionMetadata> = {}): ProviderExecutionMetadata {
  return { provider: "anthropic", model: "claude-sonnet-5", requestId: null, inputTokens: 100, outputTokens: 50, latencyMs: 1000, attempt: 1, ...overrides };
}

describe("computeBaselineExtraMetrics", () => {
  it("averages latency and sums tokens across runs", () => {
    const result = computeBaselineExtraMetrics([metadata({ latencyMs: 1000, inputTokens: 100, outputTokens: 50 }), metadata({ latencyMs: 2000, inputTokens: 200, outputTokens: 100 })]);
    expect(result.averageLatencyMs).toBe(1500);
    expect(result.totalInputTokens).toBe(300);
    expect(result.totalOutputTokens).toBe(150);
  });

  it("returns nulls for an empty run list", () => {
    const result = computeBaselineExtraMetrics([]);
    expect(result.averageLatencyMs).toBeNull();
    expect(result.totalInputTokens).toBeNull();
    expect(result.totalOutputTokens).toBeNull();
  });
});
