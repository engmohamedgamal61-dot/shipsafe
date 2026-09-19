import path from "node:path";
import { describe, expect, it } from "vitest";
import { discoverFixtureDirs, loadFixture, type LoadedFixture } from "../load-fixtures";
import { buildBaselineReport, writeBaselineArtifacts } from "./report";
import { runAllFixturesLive } from "./run";

/**
 * The ONLY entry point that invokes the real, currently-configured
 * Anthropic provider for the Code Reviewer benchmark — every call here
 * costs real money and hits a real external API. Guarded behind an
 * explicit env var so it is SKIPPED by default, including during a
 * plain `npm test` (mirrors `security-benchmarks/baseline/run.live.test.ts`).
 *
 * Run explicitly with:
 *   RUN_LIVE_CODE_BASELINE=1 npx vitest run src/server/code-benchmarks/baseline/run.live.test.ts
 */
describe.skipIf(!process.env.RUN_LIVE_CODE_BASELINE)("LIVE code benchmark baseline (real Anthropic calls)", () => {
  it(
    "runs the current production Code Reviewer against all 10 fixtures and writes the baseline artifacts",
    async () => {
      const { runs, metadata } = await runAllFixturesLive();

      const fixtures: LoadedFixture[] = discoverFixtureDirs().map((dir) => loadFixture(dir));
      const byId = new Map(fixtures.map((f) => [f.manifest.fixture_id, f]));

      const report = buildBaselineReport(runs, metadata, byId);
      const { jsonPath, markdownPath } = writeBaselineArtifacts(report, path.resolve(__dirname, "../../../.."));

      console.log(`Wrote ${jsonPath}`);
      console.log(`Wrote ${markdownPath}`);
      console.log(
        JSON.stringify(
          {
            fixturesRun: report.suite.fixturesRun,
            fixturesPassed: report.suite.fixturesPassed,
            precision: report.suite.precision,
            recall: report.suite.recall,
            p0Recall: report.suite.p0Recall,
            p1Recall: report.suite.p1Recall,
            hallucinationRate: report.suite.hallucinationRate,
            fabricatedEvidenceRate: report.suite.fabricatedEvidenceRate,
            duplicateRate: report.suite.duplicateRate,
            categoryAccuracyRate: report.suite.categoryAccuracyRate,
            safeCodeFalsePositiveRate: report.extraMetrics.safeCodeFalsePositiveRate,
            ambiguousOverclaimRate: report.extraMetrics.ambiguousOverclaimRate,
            providerOrAdapterFailures: report.fixturesWithProviderOrAdapterFailure,
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
