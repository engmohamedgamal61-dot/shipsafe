import type { ProviderExecutionMetadata, ReviewerKind } from "@/domain/types";
import type { AgentReviewOutput } from "@/domain/schemas";
import type { ReviewContext } from "../types";

/**
 * The five specialist reviewers actually review a diff. `judge` is
 * excluded here — it never goes through `AIProvider`; see
 * `ReleaseJudgePort` in `./judge-provider.ts`.
 */
export type DiffReviewerKind = Exclude<ReviewerKind, "judge">;

export interface AgentReviewInput {
  reviewer: DiffReviewerKind;
  instructions: string;
  context: ReviewContext;
  /** Which attempt this is (1 = first try). Passed through so a real provider can log/rate-limit accordingly. */
  attempt: number;
}

export interface AgentReviewResult {
  output: AgentReviewOutput;
  metadata: ProviderExecutionMetadata;
}

export type ProviderErrorKind = "retryable" | "terminal";

/**
 * Thrown by an `AIProvider` (or `ReleaseJudgePort`) implementation to
 * classify a failure for the orchestrator's retry policy.
 *
 * - `retryable`: transient — timeouts, rate limits, network errors,
 *   5xx from the provider. The orchestrator retries once.
 * - `terminal`: will not succeed on retry — invalid input, a schema the
 *   provider can't satisfy, auth failure. The orchestrator fails the run
 *   immediately without wasting a retry.
 *
 * Any error that isn't a `ProviderError` (a bug, an unexpected throw) is
 * treated as terminal — the orchestrator never retries an error it can't
 * classify.
 */
export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly kind: ProviderErrorKind,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "ProviderError";
  }
}

/**
 * Port every AI provider implements. `MockAIProvider` (today) runs real
 * heuristics over the diff; `AnthropicProvider` (Phase 2) sends the same
 * input to Claude and validates the response against the same schema.
 * No agent or orchestrator code depends on which one is wired up.
 */
export interface AIProvider {
  review(input: AgentReviewInput): Promise<AgentReviewResult>;
}
