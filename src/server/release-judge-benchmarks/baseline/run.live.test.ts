import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildBaselineReport, writeBaselineArtifacts } from "./report";
import { runAllFixturesLive } from "./run";

/**
 * The ONLY entry point that invokes the real, currently-configured
 * Anthropic provider for the Release Judge benchmark — every call here
 * costs real money and hits a real external API. Guarded behind an
 * explicit env var so it is SKIPPED by default, including during a
 * plain `npm test` (mirrors the five specialist reviewers'
 * `baseline/run.live.test.ts`).
 *
 * Run explicitly with:
 *   RUN_LIVE_RELEASE_JUDGE_BASELINE=1 node --env-file=.env.local node_modules/.bin/vitest run src/server/release-judge-benchmarks/baseline/run.live.test.ts
 */
describe.skipIf(!process.env.RUN_LIVE_RELEASE_JUDGE_BASELINE)("LIVE release-judge benchmark baseline (real Anthropic calls)", () => {
  it(
    "runs the current production Release Judge against all 10 fixtures and writes the baseline artifacts",
    async () => {
      const { runs, metadata } = await runAllFixturesLive();

      const report = buildBaselineReport(runs, metadata);
      const { jsonPath, markdownPath } = writeBaselineArtifacts(report, path.resolve(__dirname, "../../../.."));

      console.log(`Wrote ${jsonPath}`);
      console.log(`Wrote ${markdownPath}`);
      console.log(
        JSON.stringify(
          {
            fixturesRun: report.suite.fixturesRun,
            productionFacingFixturesRun: report.suite.productionFacingFixturesRun,
            fixturesPassed: report.suite.fixturesPassed,
            verdictAccuracy: report.suite.verdictAccuracy,
            blockingDefectRecall: report.suite.blockingDefectRecall,
            falseBlockRate: report.suite.falseBlockRate,
            missedBlockerRate: report.suite.missedBlockerRate,
            duplicateRiskInflationRate: report.suite.duplicateRiskInflationRate,
            lowConfidenceOverescalationRate: report.suite.lowConfidenceOverescalationRate,
            rawJudgeFailedReviewerHandlingRate: report.suite.rawJudgeFailedReviewerHandlingRate,
            severityFloorComplianceRate: report.suite.severityFloorComplianceRate,
            rationaleGroundingAccuracy: report.suite.rationaleGroundingAccuracy,
            hallucinatedFindingRate: report.suite.hallucinatedFindingRate,
            fixturesWithProviderFailure: report.fixturesWithProviderFailure,
          },
          null,
          2,
        ),
      );

      expect(report.fixtures).toHaveLength(10);
    },
    500_000,
  );
});
