import type { Finding } from "@/domain/types";
import { env, isAnthropicConfigured } from "@/lib/env";
import { SecurityReviewerAgent } from "@/server/review-engine/agents/security-reviewer";
import { AnthropicProvider } from "@/server/review-engine/providers/anthropic-provider";
import { ProviderError, type AgentReviewResult } from "@/server/review-engine/providers/provider";
import type { ReviewContext } from "@/server/review-engine/types";
import { AdapterValidationError, adaptPersistedFindings } from "../adapter";
import { discoverFixtureDirs, loadFixture, type LoadedFixture } from "../load-fixtures";
import { currentBenchmarkVersions, type BenchmarkRunMetadata } from "../run-metadata";
import { scoreFixture, type FixtureScore } from "../scorer";
import { buildReviewContextFromFixture } from "./context";

/**
 * This module invokes the CURRENT, unmodified production
 * `SecurityReviewerAgent` + `AnthropicProvider` — the exact same
 * classes `ReviewOrchestrator` (`orchestrator.ts`) wires up for a real
 * PR review — against real Anthropic calls. It is intentionally
 * NEVER imported from `npm test`'s default run; the only entry point
 * is `run.live.test.ts`, gated behind an explicit env var, because
 * every call here costs real money and hits a real external API.
 *
 * `ReviewOrchestrator` itself is deliberately NOT reused directly: it
 * constructs and runs all five specialist reviewers plus the Release
 * Judge, none of which this benchmark grades — reusing it would 5x+ the
 * API cost of this run for reviewers whose output is thrown away, and
 * would also persist through `attachReviewIds` machinery this benchmark
 * has no use for. What IS reused, unmodified, from production: the
 * `SecurityReviewerAgent` class (same `kind`, same `instructions` string
 * baked into its `review()` method — this file never constructs its own
 * prompt) and the `AnthropicProvider` class (same model/token/timeout
 * config, same schema validation, same known-file-hallucination guard).
 */

/**
 * Mirrors `ReviewOrchestrator.withRetry`'s documented one-retry policy
 * (`orchestrator.ts`: `MAX_ATTEMPTS = 2`, retry only a `ProviderError`
 * classified `"retryable"`) — that method is private to a class this
 * module deliberately does not instantiate (see the module doc comment
 * above). This is a five-line reproduction of a retry LOOP, not of any
 * reviewing/scoring logic; the reviewer call it wraps (`agent.review`)
 * is the unmodified production agent.
 */
const MAX_ATTEMPTS = 2;

async function reviewWithRetry(
  agent: SecurityReviewerAgent,
  context: ReviewContext,
): Promise<{ ok: true; result: AgentReviewResult } | { ok: false; errorMessage: string }> {
  let lastErrorMessage = "Unknown error";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await agent.review(context, attempt);
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
  | { status: "scored"; score: FixtureScore; rawSummary: string; metadata: AgentReviewResult["metadata"] }
  | { status: "provider_failure"; errorMessage: string }
  | { status: "adapter_failure"; errorMessage: string; metadata: AgentReviewResult["metadata"] };

export interface BaselineFixtureRun {
  fixtureId: string;
  domain: string;
  tags: string[];
  fixtureDir: string;
  outcome: BaselineFixtureOutcome;
}

/**
 * Runs the CURRENT production Security Reviewer once against a single
 * fixture and scores the result. Never throws — a provider failure or
 * an adapter-rejected malformed finding is captured in `outcome`
 * instead, so one fixture's failure can never abort the whole suite run
 * (mirrors the benchmark plan §5.3's "fixtures must not leak context to
 * each other" independence requirement).
 */
export async function runFixtureLive(fixture: LoadedFixture, agent: SecurityReviewerAgent): Promise<BaselineFixtureRun> {
  const base = { fixtureId: fixture.manifest.fixture_id, domain: fixture.manifest.domain, tags: fixture.manifest.tags, fixtureDir: fixture.fixtureDir };
  const context = buildReviewContextFromFixture(fixture);
  const outcome = await reviewWithRetry(agent, context);

  if (!outcome.ok) {
    return { ...base, outcome: { status: "provider_failure", errorMessage: outcome.errorMessage } };
  }

  const { output, metadata } = outcome.result;
  const findings: Finding[] = output.findings.map((f, index) => ({
    id: `${fixture.manifest.fixture_id}-finding-${index}`,
    reviewerRunId: `${fixture.manifest.fixture_id}-run`,
    ...f,
  }));

  let reviewerResult;
  try {
    reviewerResult = adaptPersistedFindings(findings);
  } catch (error) {
    const message = error instanceof AdapterValidationError ? error.message : String(error);
    return { ...base, outcome: { status: "adapter_failure", errorMessage: message, metadata } };
  }

  const score = scoreFixture(fixture, reviewerResult);
  return { ...base, outcome: { status: "scored", score, rawSummary: output.summary, metadata } };
}

export interface BaselineRunResult {
  runs: BaselineFixtureRun[];
  metadata: BenchmarkRunMetadata;
}

/**
 * Runs every fixture under `tests/security-benchmarks/` sequentially
 * (concurrency 1 — see the report's methodology note on why this first
 * baseline run deliberately doesn't parallelize) against the real,
 * currently-configured Anthropic provider.
 */
export async function runAllFixturesLive(): Promise<BaselineRunResult> {
  if (!isAnthropicConfigured || !env.ANTHROPIC_API_KEY) {
    throw new Error(
      "runAllFixturesLive: AI_PROVIDER=anthropic and a non-empty ANTHROPIC_API_KEY must both be set to run the real compatibility baseline",
    );
  }

  const provider = new AnthropicProvider(env.ANTHROPIC_API_KEY);
  const agent = new SecurityReviewerAgent(provider);

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
