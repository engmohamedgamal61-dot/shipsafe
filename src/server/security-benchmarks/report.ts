import { computeDeferredMetrics, type DeferredMetrics } from "./deferred-metrics";
import type { BenchmarkRunMetadata } from "./run-metadata";
import { aggregateScores, buildCompatibilityReport, type CompatibilityReportRow, type FixtureScore, type SuiteMetrics } from "./scorer";

/**
 * The report shape plan §8 requires every benchmark run to produce —
 * this is the concrete implementation of that section's "Required
 * benchmark report header," now that Tasks 3/4/5/6 give it real content
 * to carry instead of the placeholder JSON sketch the plan previously
 * showed. Nothing in this module calls a model or reads the filesystem
 * — it is a pure assembly step over already-scored fixtures plus the
 * metadata a harness collected about its own run.
 */
export interface BenchmarkReport {
  metadata: BenchmarkRunMetadata;
  suite: SuiteMetrics;
  deferredMetrics: DeferredMetrics;
  /** One row per produced finding across the whole run, in fixture order — the plan §4.5 compatibility report, run-wide rather than per-fixture. */
  compatibility: Array<{ fixtureId: string } & CompatibilityReportRow>;
}

export function buildBenchmarkReport(scores: readonly FixtureScore[], metadata: BenchmarkRunMetadata): BenchmarkReport {
  const compatibility = scores.flatMap((score) =>
    buildCompatibilityReport(score).map((row) => ({ fixtureId: score.fixtureId, ...row })),
  );

  return {
    metadata,
    suite: aggregateScores([...scores]),
    deferredMetrics: computeDeferredMetrics(scores),
    compatibility,
  };
}
