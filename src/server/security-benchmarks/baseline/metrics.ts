import type { ProviderExecutionMetadata } from "@/domain/types";
import type { LoadedFixture } from "../load-fixtures";
import type { FixtureScore } from "../scorer";

/**
 * Suite-level metrics `aggregateScores` (`scorer.ts`) doesn't compute,
 * because they're not generic per-fixture-score rollups — they need the
 * fixture's own tags (safe/ambiguous) and the provider's own call
 * metadata (latency/tokens), neither of which `FixtureScore` alone
 * carries. Kept in the baseline module rather than `scorer.ts` since
 * they're specific to a live-run REPORT, not to scoring itself.
 */
export interface BaselineExtraMetrics {
  /** Plan §1: of `safe`/`false_positive_trap`-tagged fixtures, the fraction where ANY finding at all was produced. `0` (not `1`) when there are no such fixtures in this run — there is nothing to have gotten wrong. */
  safeCodeFalsePositiveRate: number;
  /** Plan §1: of `ambiguous`-tagged fixtures, the fraction where the reviewer asserted a confident (non-`"low"`) finding instead of `needs_more_context`/zero findings/a low-confidence optional match. `0` when there are no ambiguous fixtures in this run. */
  ambiguousOverclaimRate: number;
  /** `null` when no fixture produced a scored run to measure (e.g. every call failed). */
  averageLatencyMs: number | null;
  totalInputTokens: number | null;
  totalOutputTokens: number | null;
}

export interface ScoredFixtureRun {
  fixture: LoadedFixture;
  score: FixtureScore;
  metadata: ProviderExecutionMetadata;
}

function average(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length;
}

function sumOrNull(values: readonly (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  return present.length === 0 ? null : present.reduce((sum, v) => sum + v, 0);
}

export function computeBaselineExtraMetrics(runs: readonly ScoredFixtureRun[]): BaselineExtraMetrics {
  const safeRuns = runs.filter((r) => r.fixture.manifest.tags.some((t) => t === "safe" || t === "false_positive_trap"));
  const ambiguousRuns = runs.filter((r) => r.fixture.manifest.tags.includes("ambiguous"));

  const safeFalsePositives = safeRuns.filter((r) => r.score.allFindings.length > 0).length;
  const ambiguousOverclaims = ambiguousRuns.filter((r) => r.score.prohibitedFindings.length > 0).length;

  return {
    safeCodeFalsePositiveRate: safeRuns.length === 0 ? 0 : safeFalsePositives / safeRuns.length,
    ambiguousOverclaimRate: ambiguousRuns.length === 0 ? 0 : ambiguousOverclaims / ambiguousRuns.length,
    averageLatencyMs: average(runs.map((r) => r.metadata.latencyMs)),
    totalInputTokens: sumOrNull(runs.map((r) => r.metadata.inputTokens)),
    totalOutputTokens: sumOrNull(runs.map((r) => r.metadata.outputTokens)),
  };
}
