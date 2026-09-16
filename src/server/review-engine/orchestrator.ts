import { randomUUID } from "node:crypto";
import type { Finding, ProviderExecutionMetadata, Review, ReviewerRun, Verdict } from "@/domain/types";
import { agentReviewOutputSchema } from "@/domain/schemas";
import { applyVerdictFloor, checkRequiredReviewers } from "@/domain/verdict";
import { logger } from "@/lib/logger";
import type { ReviewAgent, ReviewContext } from "./types";
import { ProviderError, type AIProvider } from "./providers/provider";
import type { ReleaseJudgePort } from "./providers/judge-provider";
import { CodeReviewerAgent } from "./agents/code-reviewer";
import { SecurityReviewerAgent } from "./agents/security-reviewer";
import { ArchitectureReviewerAgent } from "./agents/architecture-reviewer";
import { DatabaseReviewerAgent } from "./agents/database-reviewer";
import { TestReviewerAgent } from "./agents/test-reviewer";
import { ReleaseJudgeAgent } from "./agents/release-judge";

/**
 * One retry for a retryable provider error — never more. See
 * `ProviderError`. Applies uniformly to the five specialist reviewers
 * AND the Release Judge (`withRetry` below is the one place this policy
 * is implemented) — a transient judge failure gets exactly the same
 * one-retry treatment as a transient reviewer failure, no separate path.
 */
const MAX_ATTEMPTS = 2;

type RetryOutcome<T> = { ok: true; value: T } | { ok: false; errorMessage: string };

export interface OrchestratorResult {
  status: Review["status"];
  verdict: Review["verdict"];
  summary: string;
  failureReason: string | null;
  startedAt: string;
  completedAt: string;
  reviewerRuns: ReviewerRun[];
}

/**
 * Runs the five specialist agents concurrently, then the Release Judge,
 * and returns the assembled result. This function is pure with respect
 * to persistence — the caller (a repository/service, see
 * `src/server/demo/seed.ts`) is responsible for storing the result.
 *
 * Fail-closed by construction, and enforced HERE rather than delegated to
 * the judge:
 *
 * 1. `checkRequiredReviewers` runs against the specialist `ReviewerRun`s
 *    before the judge is ever invoked. If any required reviewer isn't
 *    `status: "complete"`, the judge is skipped entirely — there is no
 *    code path where an adversarial or buggy `ReleaseJudgePort`
 *    implementation gets a chance to override this with an `APPROVE`,
 *    because it is never called. `status: "failed"` and
 *    `verdict: "DO_NOT_APPROVE"` are set directly.
 * 2. When the judge IS called and succeeds, its verdict is passed through
 *    `applyVerdictFloor(allFindings, judgeVerdict)` before being trusted
 *    — the deterministic floor computed from the findings can only make
 *    the verdict stricter, never more lenient. A judge that returns
 *    `APPROVE` in the face of a P0 finding is silently corrected, not
 *    trusted. See `orchestrator.test.ts`'s adversarial "always APPROVE"
 *    judge tests for both of the above.
 * 3. If the judge itself fails after retries, the same fail-closed
 *    default applies directly.
 *
 * There is no code path that returns `status: "complete"` with a verdict
 * more lenient than either of these two independent checks allows.
 */
export class ReviewOrchestrator {
  private readonly agents: ReviewAgent[];
  private readonly judge: ReleaseJudgeAgent;

  constructor(provider: AIProvider, judgePort: ReleaseJudgePort) {
    this.agents = [
      new CodeReviewerAgent(provider),
      new SecurityReviewerAgent(provider),
      new ArchitectureReviewerAgent(provider),
      new DatabaseReviewerAgent(provider),
      new TestReviewerAgent(provider),
    ];
    this.judge = new ReleaseJudgeAgent(judgePort);
  }

  async run(context: ReviewContext): Promise<OrchestratorResult> {
    const startedAt = new Date().toISOString();

    // Promise.all is safe here because runAgent never rejects — every
    // reviewer's own failure (thrown or otherwise) is caught and turned
    // into a `status: "failed"` run, so one reviewer throwing can never
    // short-circuit the others.
    const reviewerRuns = await Promise.all(
      this.agents.map((agent) => this.runAgent(agent, context)),
    );

    const requiredCheck = checkRequiredReviewers(reviewerRuns);

    let verdict: Verdict;
    let summary: string;
    let failureReason: string | null;
    let judgeStatus: ReviewerRun["status"];
    let judgeErrorMessage: string | null = null;
    let judgeMetadata: ProviderExecutionMetadata | null = null;
    let judgeStartedAt: string | null = null;
    let judgeCompletedAt: string | null = null;

    if (requiredCheck.blocked) {
      // Fail-closed, enforced before the judge is ever invoked. The judge
      // consolidates the specialist reviewers' findings — without a
      // required reviewer's result, there is nothing trustworthy to
      // consolidate, so we don't ask it to try. `judgeStatus: "pending"`
      // accurately reflects "never started", not "failed" — nothing
      // about the judge itself went wrong here.
      failureReason = requiredCheck.failureReason;
      verdict = "DO_NOT_APPROVE";
      summary = failureReason;
      judgeStatus = "pending";
    } else {
      judgeStartedAt = new Date().toISOString();
      const outcome = await this.withRetry("release-judge", (attempt) =>
        this.judge.judge(reviewerRuns, attempt),
      );
      judgeCompletedAt = new Date().toISOString();

      if (outcome.ok) {
        const allFindings = reviewerRuns.flatMap((run) => run.findings);
        verdict = applyVerdictFloor(allFindings, outcome.value.output.verdict);
        summary = outcome.value.output.summary;
        failureReason = null;
        judgeStatus = "complete";
        judgeMetadata = outcome.value.metadata;
      } else {
        // The judge failing is exactly as serious as a required reviewer
        // failing: with no judge, there is no trustworthy verdict, so
        // this must fail closed rather than fall back to a default of
        // APPROVE.
        judgeErrorMessage = outcome.errorMessage;
        logger.error("release judge failed", { error: judgeErrorMessage });
        judgeStatus = "failed";
        verdict = "DO_NOT_APPROVE";
        failureReason = `Release Judge failed to produce a verdict: ${judgeErrorMessage}`;
        summary = failureReason;
      }
    }

    const judgeRun: ReviewerRun = {
      id: randomUUID(),
      reviewId: "", // assigned by the caller once the Review row exists
      reviewer: "judge",
      status: judgeStatus,
      summary,
      errorMessage: judgeErrorMessage,
      providerMetadata: judgeMetadata,
      startedAt: judgeStartedAt,
      completedAt: judgeCompletedAt,
      findings: [],
    };

    const completedAt = new Date().toISOString();

    return {
      // `failureReason` (set by the required-reviewer check, or by the
      // judge itself failing above) is the single source of truth for
      // whether this review is trustworthy — status tracks it directly
      // so the two can never disagree.
      status: failureReason ? "failed" : "complete",
      verdict,
      summary,
      failureReason,
      startedAt,
      completedAt,
      reviewerRuns: [...reviewerRuns, judgeRun],
    };
  }

  private async runAgent(agent: ReviewAgent, context: ReviewContext): Promise<ReviewerRun> {
    const startedAt = new Date().toISOString();
    const outcome = await this.withRetry(`reviewer:${agent.kind}`, (attempt) =>
      agent.review(context, attempt),
    );

    if (outcome.ok) {
      const output = agentReviewOutputSchema.parse(outcome.value.output);
      const completedAt = new Date().toISOString();

      const findings: Finding[] = output.findings.map((f) => ({
        id: randomUUID(),
        reviewerRunId: "", // backfilled by the caller once the run id is known
        ...f,
      }));

      return {
        id: randomUUID(),
        reviewId: "",
        reviewer: agent.kind,
        status: "complete",
        summary: output.summary,
        errorMessage: null,
        providerMetadata: outcome.value.metadata,
        startedAt,
        completedAt,
        findings,
      };
    }

    return {
      id: randomUUID(),
      reviewId: "",
      reviewer: agent.kind,
      status: "failed",
      summary:
        "This reviewer failed to complete. Treat this PR as unreviewed for its domain until it's re-run.",
      errorMessage: outcome.errorMessage,
      providerMetadata: null,
      startedAt,
      completedAt: new Date().toISOString(),
      findings: [],
    };
  }

  /**
   * Shared retry policy: up to `MAX_ATTEMPTS` tries, retrying only when
   * the thrown error is a `ProviderError` classified `"retryable"`. Any
   * other error (a `"terminal"` `ProviderError`, or anything that isn't a
   * `ProviderError` at all) fails immediately without consuming a retry.
   * Used identically by `runAgent` (the five specialist reviewers) and by
   * the Release Judge call in `run()` — one implementation, so the two
   * can't drift into inconsistent retry behavior.
   */
  private async withRetry<T>(
    label: string,
    operation: (attempt: number) => Promise<T>,
  ): Promise<RetryOutcome<T>> {
    let lastErrorMessage = "Unknown error";

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const value = await operation(attempt);
        return { ok: true, value };
      } catch (error) {
        lastErrorMessage = error instanceof Error ? error.message : String(error);
        const retryable = error instanceof ProviderError && error.kind === "retryable";

        logger.error(`${label} attempt failed`, {
          attempt,
          retryable,
          error: lastErrorMessage,
        });

        if (retryable && attempt < MAX_ATTEMPTS) {
          continue;
        }
        break;
      }
    }

    return { ok: false, errorMessage: lastErrorMessage };
  }
}

/**
 * Backfills `reviewId`/`reviewerRunId` foreign keys once the parent
 * `Review` id is known. Keeping the orchestrator itself id-agnostic means
 * it never needs to know how ids are allocated (uuid v4 locally vs.
 * Supabase-generated).
 */
export function attachReviewIds(
  reviewId: string,
  reviewerRuns: ReviewerRun[],
): ReviewerRun[] {
  return reviewerRuns.map((run) => ({
    ...run,
    reviewId,
    findings: run.findings.map((f) => ({ ...f, reviewerRunId: run.id })),
  }));
}
