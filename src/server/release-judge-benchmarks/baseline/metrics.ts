import type { ProviderExecutionMetadata } from "@/domain/types";

/** Run-level extras `aggregateScores` (`scorer.ts`) doesn't compute — latency/token usage, which is about the provider call, not the judge's decision quality. */
export interface BaselineExtraMetrics {
  averageLatencyMs: number | null;
  totalInputTokens: number | null;
  totalOutputTokens: number | null;
}

function average(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length;
}

function sumOrNull(values: readonly (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  return present.length === 0 ? null : present.reduce((sum, v) => sum + v, 0);
}

export function computeBaselineExtraMetrics(metadataList: readonly ProviderExecutionMetadata[]): BaselineExtraMetrics {
  return {
    averageLatencyMs: average(metadataList.map((m) => m.latencyMs)),
    totalInputTokens: sumOrNull(metadataList.map((m) => m.inputTokens)),
    totalOutputTokens: sumOrNull(metadataList.map((m) => m.outputTokens)),
  };
}
