import type { Finding } from "@/domain/types";
import { env, isAnthropicConfigured } from "@/lib/env";
import { CodeReviewerAgent } from "@/server/review-engine/agents/code-reviewer";
import { AnthropicProvider } from "@/server/review-engine/providers/anthropic-provider";
import { ProviderError, type AgentReviewResult } from "@/server/review-engine/providers/provider";
import type { ReviewContext } from "@/server/review-engine/types";
import { AdapterValidationError, adaptPersistedFindings } from "../adapter";
import { discoverFixtureDirs, loadFixture, type LoadedFixture } from "../load-fixtures";
import { currentBenchmarkVersions, type BenchmarkRunMetadata } from "../run-metadata";
import { scoreFixture, type FixtureScore } from "../scorer";
import { buildReviewContextFromFixture } from "./context";

/**
 * Invokes the CURRENT, unmodified production `CodeReviewerAgent` +
 * `AnthropicProvider` — identical in design to
 * `security-benchmarks/baseline/run.ts` (see that file's own doc
 * comment for why `ReviewOrchestrator` itself is deliberately NOT
 * reused: it would run all five specialist reviewers plus the Release
 * Judge for output this benchmark doesn't grade). Never imported from
 * `npm test`'s default run — the only entry point is
 * `run.live.test.ts`, gated behind an explicit env var, since every
 * call here costs real money and hits a real external API.
 */
const MAX_ATTEMPTS = 2;

async function reviewWithRetry(
  agent: CodeReviewerAgent,
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

export async function runFixtureLive(fixture: LoadedFixture, agent: CodeReviewerAgent): Promise<BaselineFixtureRun> {
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

export async function runAllFixturesLive(): Promise<BaselineRunResult> {
  if (!isAnthropicConfigured || !env.ANTHROPIC_API_KEY) {
    throw new Error("runAllFixturesLive: AI_PROVIDER=anthropic and a non-empty ANTHROPIC_API_KEY must both be set to run the real compatibility baseline");
  }

  const provider = new AnthropicProvider(env.ANTHROPIC_API_KEY);
  const agent = new CodeReviewerAgent(provider);

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
