import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { agentReviewOutputSchema, type AgentReviewOutput } from "@/domain/schemas";
import { env } from "@/lib/env";
import { buildReviewerSystemPrompt, buildReviewerUserPrompt } from "./prompt";
import { ConcurrencyLimiter } from "./concurrency-limiter";
import {
  ProviderError,
  type AgentReviewInput,
  type AgentReviewResult,
  type AIProvider,
  type DiffReviewerKind,
} from "./provider";
import type { ReviewContext } from "../types";

/**
 * Shared across every `AnthropicProvider` instance in this process — the
 * cap is on total concurrent Anthropic calls for the deployment
 * (`AI_MAX_CONCURRENT_REVIEWERS`), not per-review, so it must not be
 * re-created per orchestrator run.
 */
const reviewerLimiter = new ConcurrencyLimiter(env.AI_MAX_CONCURRENT_REVIEWERS);

/**
 * Real Claude-backed `AIProvider`. Sends the same `AgentReviewInput` every
 * `MockAIProvider` call receives to the Anthropic API and validates the
 * structured response against `agentReviewOutputSchema` — no agent or
 * orchestrator code changes when this replaces the mock (see
 * docs/ARCHITECTURE.md § AI Provider abstraction).
 */
export class AnthropicProvider implements AIProvider {
  private readonly client: Anthropic;

  /**
   * `client` is only ever overridden by tests, to inject a fake with a
   * stubbed `messages.parse` — production code always goes through the
   * `apiKey` branch.
   */
  constructor(apiKey: string, client?: Anthropic) {
    if (client) {
      this.client = client;
    } else {
      if (!apiKey) {
        throw new Error("AnthropicProvider requires a non-empty API key");
      }
      this.client = new Anthropic({ apiKey });
    }
  }

  review(input: AgentReviewInput): Promise<AgentReviewResult> {
    return reviewerLimiter.run(() => this.reviewOnce(input));
  }

  private async reviewOnce(input: AgentReviewInput): Promise<AgentReviewResult> {
    const startedAt = Date.now();

    let message;
    try {
      message = await this.client.messages.parse(
        {
          model: env.ANTHROPIC_MODEL,
          max_tokens: env.AI_MAX_TOKENS_PER_REVIEWER,
          system: buildReviewerSystemPrompt(input.instructions),
          messages: [{ role: "user", content: buildReviewerUserPrompt(input.context) }],
          output_config: { format: zodOutputFormat(agentReviewOutputSchema) },
        },
        { timeout: env.AI_REQUEST_TIMEOUT_MS },
      );
    } catch (error) {
      throw classifyAnthropicError(error, input.reviewer);
    }

    if (!message.parsed_output) {
      // The model didn't produce a response matching the schema at all —
      // a structural failure, not the kind of one-off content mistake
      // `assertKnownFileReferences` below retries. Fail closed without
      // spending a retry on it.
      throw new ProviderError(
        `Anthropic response for the ${input.reviewer} reviewer did not match the expected schema`,
        "terminal",
      );
    }

    const output = assertKnownFileReferences(message.parsed_output, input.context, input.reviewer);

    return {
      output,
      metadata: {
        provider: "anthropic",
        model: env.ANTHROPIC_MODEL,
        requestId: message._request_id ?? null,
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        latencyMs: Date.now() - startedAt,
        attempt: input.attempt,
      },
    };
  }
}

/**
 * The model is instructed never to cite a `filePath` outside the diff it
 * was given (see `buildReviewerSystemPrompt`), but instructions alone
 * don't guarantee compliance. Rather than persist a fabricated line
 * reference, reject the whole response and let the orchestrator's retry
 * policy ask again — a fresh sample is a reasonable fix for what is most
 * likely sampling noise, not a systemic problem.
 */
function assertKnownFileReferences(
  output: AgentReviewOutput,
  context: ReviewContext,
  reviewer: DiffReviewerKind,
): AgentReviewOutput {
  const knownPaths = new Set(context.changedFiles.map((f) => f.path));
  const hallucinated = output.findings.find((f) => f.filePath && !knownPaths.has(f.filePath));

  if (hallucinated) {
    throw new ProviderError(
      `Anthropic response for the ${reviewer} reviewer cited a file (${hallucinated.filePath}) that is not in this diff's changed-file list`,
      "retryable",
    );
  }

  return output;
}

/**
 * Maps the Anthropic SDK's typed exception hierarchy onto the
 * orchestrator's binary retry classification. Order matters:
 * `APIConnectionError` must be checked ahead of the generic `APIError`
 * fallback because it's a *subclass* of `APIError` in this SDK.
 */
function classifyAnthropicError(error: unknown, reviewer: DiffReviewerKind): ProviderError {
  if (
    error instanceof Anthropic.RateLimitError ||
    error instanceof Anthropic.InternalServerError ||
    error instanceof Anthropic.APIConnectionError // includes APIConnectionTimeoutError
  ) {
    return new ProviderError(
      `Anthropic request for the ${reviewer} reviewer failed transiently: ${error.message}`,
      "retryable",
      { cause: error },
    );
  }

  if (error instanceof Anthropic.APIError) {
    return new ProviderError(
      `Anthropic request for the ${reviewer} reviewer failed: ${error.message}`,
      "terminal",
      { cause: error },
    );
  }

  const message = error instanceof Error ? error.message : String(error);
  return new ProviderError(
    `Anthropic request for the ${reviewer} reviewer failed unexpectedly: ${message}`,
    "terminal",
    { cause: error },
  );
}
