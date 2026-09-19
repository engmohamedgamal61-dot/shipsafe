import { env, isAnthropicConfigured } from "@/lib/env";
import { ReleaseJudgeAgent } from "@/server/review-engine/agents/release-judge";
import { AnthropicJudgeProvider, type ReleaseJudgeResult } from "@/server/review-engine/providers/judge-provider";
import { ProviderError } from "@/server/review-engine/providers/provider";
import { discoverFixtureDirs, loadFixture, type LoadedFixture } from "../load-fixtures";
import { currentBenchmarkVersions, type BenchmarkRunMetadata } from "../run-metadata";
import { scoreFixture, type JudgeFixtureScore } from "../scorer";
import { buildReviewerRunsFromFixture } from "./context";

/**
 * Invokes the CURRENT, unmodified production `ReleaseJudgeAgent`
 * (wrapping the real `AnthropicJudgeProvider`) directly — never
 * `ReviewOrchestrator`, which would also (a) run the five specialist
 * reviewers for output this benchmark doesn't need and (b) apply
 * `checkRequiredReviewers`/`applyVerdictFloor` BEFORE the judge is even
 * reached, which for fixture 9 (incomplete required-reviewer coverage)
 * would mean the judge is never called at all in production.
 *
 * Deliberately calls the real `ReleaseJudgeAgent`, not the bare
 * `AnthropicJudgeProvider`, so this benchmark measures exactly what
 * production returns — including `ReleaseJudgeAgent`'s own
 * `enforceMinimumVerdictForAnyFinding` normalization — the same
 * principle every specialist reviewer benchmark already follows
 * (calling `TestReviewerAgent`, not `AnthropicProvider`, etc.).
 *
 * This benchmark deliberately calls the agent anyway on every fixture,
 * including the incomplete-coverage one, as a defense-in-depth probe of
 * the judge's OWN behavior — see `scorer.ts`'s `judgeAlsoRecognizedGap`
 * and this benchmark's README for why that is informational rather than
 * the primary safety mechanism (the orchestrator's deterministic,
 * unmodified fail-closed check already guarantees the real production
 * outcome regardless of what the judge says here).
 *
 * Never imported from `npm test`'s default run — the only entry point
 * is `run.live.test.ts`, gated behind an explicit env var, since every
 * call here costs real money and hits a real external API.
 */
const MAX_ATTEMPTS = 2;

async function judgeWithRetry(
  agent: ReleaseJudgeAgent,
  reviewerRuns: ReturnType<typeof buildReviewerRunsFromFixture>,
): Promise<{ ok: true; result: ReleaseJudgeResult } | { ok: false; errorMessage: string }> {
  let lastErrorMessage = "Unknown error";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await agent.judge(reviewerRuns, attempt);
      return { ok: true, result };
    } catch (error) {
      lastErrorMessage = error instanceof Error ? error.message : String(error);
      const retryable = error instanceof ProviderError && error.kind === "retryable";
      if (retryable && attempt < MAX_ATTEMPTS) continue;
      break;
    }
  }
  return { ok: false, errorMessage: lastErrorMessage };
}

export type BaselineFixtureOutcome =
  | { status: "scored"; score: JudgeFixtureScore; rawSummary: string; metadata: ReleaseJudgeResult["metadata"] }
  | { status: "provider_failure"; errorMessage: string };

export interface BaselineFixtureRun {
  fixtureId: string;
  domain: string;
  tags: string[];
  fixtureDir: string;
  outcome: BaselineFixtureOutcome;
}

export async function runFixtureLive(fixture: LoadedFixture, agent: ReleaseJudgeAgent): Promise<BaselineFixtureRun> {
  const base = { fixtureId: fixture.manifest.fixture_id, domain: fixture.manifest.domain, tags: fixture.manifest.tags, fixtureDir: fixture.fixtureDir };
  const reviewerRuns = buildReviewerRunsFromFixture(fixture);
  const outcome = await judgeWithRetry(agent, reviewerRuns);

  if (!outcome.ok) {
    return { ...base, outcome: { status: "provider_failure", errorMessage: outcome.errorMessage } };
  }

  const { output, metadata } = outcome.result;
  const score = scoreFixture({ manifest: fixture.manifest, reviewerRuns, actualVerdict: output.verdict, actualSummary: output.summary });
  return { ...base, outcome: { status: "scored", score, rawSummary: output.summary, metadata } };
}

export interface BaselineRunResult {
  runs: BaselineFixtureRun[];
  metadata: BenchmarkRunMetadata;
}

export async function runAllFixturesLive(): Promise<BaselineRunResult> {
  if (!isAnthropicConfigured || !env.ANTHROPIC_API_KEY) {
    throw new Error("runAllFixturesLive: AI_PROVIDER=anthropic and a non-empty ANTHROPIC_API_KEY must both be set to run the real compatibility baseline");
  }

  const agent = new ReleaseJudgeAgent(new AnthropicJudgeProvider(env.ANTHROPIC_API_KEY));

  const runs: BaselineFixtureRun[] = [];
  for (const fixtureDir of discoverFixtureDirs()) {
    const fixture = loadFixture(fixtureDir);
    runs.push(await runFixtureLive(fixture, agent));
  }

  const metadata: BenchmarkRunMetadata = {
    provider: "anthropic",
    model: env.ANTHROPIC_MODEL,
    maxTokens: env.AI_MAX_TOKENS_PER_REVIEWER,
    concurrency: 1,
    timeoutMs: env.AI_REQUEST_TIMEOUT_MS,
    versions: currentBenchmarkVersions(),
    runTimestamp: new Date().toISOString(),
  };

  return { runs, metadata };
}
