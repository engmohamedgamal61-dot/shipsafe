import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { AnthropicJudgeProvider, MockReleaseJudgeProvider } from "./judge-provider";
import { ProviderError } from "./provider";
import type { ReviewerRun } from "@/domain/types";

const judge = new MockReleaseJudgeProvider();

function run(overrides: Partial<ReviewerRun> = {}): ReviewerRun {
  return {
    id: "run-1",
    reviewId: "review-1",
    reviewer: "code",
    status: "complete",
    summary: "ok",
    errorMessage: null,
    providerMetadata: null,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    findings: [],
    ...overrides,
  };
}

const ALL_REQUIRED = ["code", "security", "architecture", "database", "test"] as const;

function completeRuns(): ReviewerRun[] {
  return ALL_REQUIRED.map((reviewer) => run({ id: `run-${reviewer}`, reviewer }));
}

describe("MockReleaseJudgeProvider", () => {
  it("approves when every required reviewer completed with no findings", async () => {
    const result = await judge.judge({ reviewerRuns: completeRuns(), attempt: 1 });
    expect(result.output.verdict).toBe("APPROVE");
  });

  it("floors the verdict to DO_NOT_APPROVE when a P0 finding is present", async () => {
    const runs = completeRuns().map((r) =>
      r.reviewer === "security"
        ? run({
            ...r,
            findings: [
              {
                id: "f1",
                reviewerRunId: r.id,
                severity: "P0",
                title: "secret",
                description: "d",
                filePath: null,
                lineStart: null,
                lineEnd: null,
                category: "hardcoded-secret",
                recommendation: "rotate it",
                confidence: 1,
              },
            ],
          })
        : r,
    );
    const result = await judge.judge({ reviewerRuns: runs, attempt: 1 });
    expect(result.output.verdict).toBe("DO_NOT_APPROVE");
  });

  it("does NOT fail-close on its own when a required reviewer's run is missing — that policy lives in the orchestrator", async () => {
    // This is deliberate: the provider only ever sees reviewerRuns and
    // their findings. A required reviewer that failed contributes zero
    // findings, so a naive provider (this one) has no way to distinguish
    // "failed" from "found nothing" — which is exactly why
    // ReviewOrchestrator.run() checks `checkRequiredReviewers` BEFORE
    // ever calling this port, rather than trusting the port to do it.
    // See orchestrator.test.ts's adversarial judge tests.
    const runsMissingSecurity = completeRuns().filter((r) => r.reviewer !== "security");
    const result = await judge.judge({ reviewerRuns: runsMissingSecurity, attempt: 1 });
    expect(result.output.verdict).toBe("APPROVE");
  });

  it("returns execution metadata reflecting the given attempt", async () => {
    const result = await judge.judge({ reviewerRuns: completeRuns(), attempt: 2 });
    expect(result.metadata.provider).toBe("mock");
    expect(result.metadata.attempt).toBe(2);
    expect(result.metadata.latencyMs).toBeGreaterThanOrEqual(0);
  });
});

function fakeClient(parse: ReturnType<typeof vi.fn>): Anthropic {
  return { messages: { parse } } as unknown as Anthropic;
}

describe("AnthropicJudgeProvider", () => {
  it("maps a valid structured response into a ReleaseJudgeResult", async () => {
    const parse = vi.fn().mockResolvedValue({
      parsed_output: { verdict: "APPROVE_WITH_MINOR_FIXES", summary: "a few nits" },
      usage: { input_tokens: 30, output_tokens: 10 },
      _request_id: "req_judge1",
    });
    const judgeProvider = new AnthropicJudgeProvider("test-key", fakeClient(parse));

    const result = await judgeProvider.judge({ reviewerRuns: completeRuns(), attempt: 1 });

    expect(result.output).toEqual({ verdict: "APPROVE_WITH_MINOR_FIXES", summary: "a few nits" });
    expect(result.metadata).toEqual({
      provider: "anthropic",
      model: expect.any(String),
      requestId: "req_judge1",
      inputTokens: 30,
      outputTokens: 10,
      latencyMs: expect.any(Number),
      attempt: 1,
    });
  });

  it("fails closed (terminal) when the response doesn't match the schema", async () => {
    const parse = vi.fn().mockResolvedValue({ parsed_output: null, usage: { input_tokens: 1, output_tokens: 1 } });
    const judgeProvider = new AnthropicJudgeProvider("test-key", fakeClient(parse));

    await expect(
      judgeProvider.judge({ reviewerRuns: completeRuns(), attempt: 1 }),
    ).rejects.toMatchObject<Partial<ProviderError>>({ kind: "terminal" });
  });

  it("classifies a 429 as retryable and a 401 as terminal — same policy as AnthropicProvider", async () => {
    const rateLimited = new AnthropicJudgeProvider(
      "test-key",
      fakeClient(vi.fn().mockRejectedValue(new Anthropic.RateLimitError(429, {}, "rate limited", new Headers()))),
    );
    await expect(
      rateLimited.judge({ reviewerRuns: completeRuns(), attempt: 1 }),
    ).rejects.toMatchObject<Partial<ProviderError>>({ kind: "retryable" });

    const unauthenticated = new AnthropicJudgeProvider(
      "test-key",
      fakeClient(vi.fn().mockRejectedValue(new Anthropic.AuthenticationError(401, {}, "bad key", new Headers()))),
    );
    await expect(
      unauthenticated.judge({ reviewerRuns: completeRuns(), attempt: 1 }),
    ).rejects.toMatchObject<Partial<ProviderError>>({ kind: "terminal" });
  });

  it("adversarial: even a judge provider that always returns APPROVE is only advisory — the orchestrator, not this port, enforces the floor", async () => {
    // This provider's job is only to map the API response through; it is
    // never responsible for weighing findings itself. The floor is
    // enforced by `applyVerdictFloor` in the orchestrator — see
    // orchestrator.test.ts's adversarial always-APPROVE judge tests for
    // proof that a lenient judge output can never win.
    const parse = vi
      .fn()
      .mockResolvedValue({
        parsed_output: { verdict: "APPROVE", summary: "looks great, ship it" },
        usage: { input_tokens: 1, output_tokens: 1 },
      });
    const judgeProvider = new AnthropicJudgeProvider("test-key", fakeClient(parse));

    const result = await judgeProvider.judge({ reviewerRuns: completeRuns(), attempt: 1 });
    expect(result.output.verdict).toBe("APPROVE");
  });
});
