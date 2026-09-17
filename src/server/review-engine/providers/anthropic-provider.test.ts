import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { AnthropicProvider } from "./anthropic-provider";
import { ProviderError } from "./provider";
import type { ReviewContext } from "../types";

function context(overrides: Partial<ReviewContext> = {}): ReviewContext {
  return {
    pullRequestTitle: "Add payments retry logic",
    sourceBranch: "feature/retry",
    targetBranch: "main",
    changedFiles: [{ path: "src/a.ts", status: "modified", additions: 5, deletions: 1 }],
    diffText: "diff --git a/src/a.ts b/src/a.ts\n+const x = 1;\n",
    diffTruncated: false,
    changedFilesTruncated: false,
    ...overrides,
  };
}

function fakeClient(parse: ReturnType<typeof vi.fn>): Anthropic {
  return { messages: { parse } } as unknown as Anthropic;
}

describe("AnthropicProvider", () => {
  it("maps a valid structured response into an AgentReviewResult with usage metadata", async () => {
    const parse = vi.fn().mockResolvedValue({
      parsed_output: {
        summary: "one issue found",
        findings: [
          {
            severity: "P1",
            title: "Missing null check",
            description: "x may be null here",
            filePath: "src/a.ts",
            lineStart: 1,
            lineEnd: 1,
            category: "correctness",
            recommendation: "Add a null check",
            confidence: 0.8,
          },
        ],
      },
      usage: { input_tokens: 120, output_tokens: 45 },
      _request_id: "req_abc123",
    });
    const provider = new AnthropicProvider("test-key", fakeClient(parse));

    const result = await provider.review({
      reviewer: "code",
      instructions: "Review this diff for bugs.",
      context: context(),
      attempt: 1,
    });

    expect(result.output.summary).toBe("one issue found");
    expect(result.output.findings).toHaveLength(1);
    expect(result.metadata).toEqual({
      provider: "anthropic",
      model: expect.any(String),
      requestId: "req_abc123",
      inputTokens: 120,
      outputTokens: 45,
      latencyMs: expect.any(Number),
      attempt: 1,
    });
  });

  it("fails closed (terminal) when the response doesn't match the schema at all", async () => {
    const parse = vi.fn().mockResolvedValue({ parsed_output: null, usage: { input_tokens: 1, output_tokens: 1 } });
    const provider = new AnthropicProvider("test-key", fakeClient(parse));

    await expect(
      provider.review({ reviewer: "code", instructions: "x", context: context(), attempt: 1 }),
    ).rejects.toMatchObject<Partial<ProviderError>>({ kind: "terminal" });
  });

  it("retries (does not fail terminally) when a finding cites a file not present in the diff", async () => {
    const parse = vi.fn().mockResolvedValue({
      parsed_output: {
        summary: "found something",
        findings: [
          {
            severity: "P1",
            title: "issue",
            description: "d",
            filePath: "src/does-not-exist.ts",
            lineStart: 1,
            lineEnd: 1,
            category: "correctness",
            recommendation: "fix it",
            confidence: 0.8,
          },
        ],
      },
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const provider = new AnthropicProvider("test-key", fakeClient(parse));

    await expect(
      provider.review({ reviewer: "code", instructions: "x", context: context(), attempt: 1 }),
    ).rejects.toMatchObject<Partial<ProviderError>>({ kind: "retryable" });
  });

  it("classifies a request timeout as retryable", async () => {
    const parse = vi.fn().mockRejectedValue(new Anthropic.APIConnectionTimeoutError());
    const provider = new AnthropicProvider("test-key", fakeClient(parse));

    await expect(
      provider.review({ reviewer: "code", instructions: "x", context: context(), attempt: 1 }),
    ).rejects.toMatchObject<Partial<ProviderError>>({ kind: "retryable" });
  });

  it("classifies a 429 rate limit error as retryable", async () => {
    const parse = vi
      .fn()
      .mockRejectedValue(new Anthropic.RateLimitError(429, {}, "rate limited", new Headers()));
    const provider = new AnthropicProvider("test-key", fakeClient(parse));

    await expect(
      provider.review({ reviewer: "code", instructions: "x", context: context(), attempt: 1 }),
    ).rejects.toMatchObject<Partial<ProviderError>>({ kind: "retryable" });
  });

  it("classifies a 500 as retryable", async () => {
    const parse = vi
      .fn()
      .mockRejectedValue(new Anthropic.InternalServerError(500, {}, "server error", new Headers()));
    const provider = new AnthropicProvider("test-key", fakeClient(parse));

    await expect(
      provider.review({ reviewer: "code", instructions: "x", context: context(), attempt: 1 }),
    ).rejects.toMatchObject<Partial<ProviderError>>({ kind: "retryable" });
  });

  it("classifies a 401 authentication error as terminal", async () => {
    const parse = vi
      .fn()
      .mockRejectedValue(new Anthropic.AuthenticationError(401, {}, "invalid api key", new Headers()));
    const provider = new AnthropicProvider("test-key", fakeClient(parse));

    await expect(
      provider.review({ reviewer: "code", instructions: "x", context: context(), attempt: 1 }),
    ).rejects.toMatchObject<Partial<ProviderError>>({ kind: "terminal" });
  });

  it("classifies a 400 bad request as terminal", async () => {
    const parse = vi
      .fn()
      .mockRejectedValue(new Anthropic.BadRequestError(400, {}, "invalid request", new Headers()));
    const provider = new AnthropicProvider("test-key", fakeClient(parse));

    await expect(
      provider.review({ reviewer: "code", instructions: "x", context: context(), attempt: 1 }),
    ).rejects.toMatchObject<Partial<ProviderError>>({ kind: "terminal" });
  });

  it("treats an unclassified throw as terminal, same as the orchestrator's own policy", async () => {
    const parse = vi.fn().mockRejectedValue(new Error("boom"));
    const provider = new AnthropicProvider("test-key", fakeClient(parse));

    await expect(
      provider.review({ reviewer: "code", instructions: "x", context: context(), attempt: 1 }),
    ).rejects.toMatchObject<Partial<ProviderError>>({ kind: "terminal" });
  });
});
