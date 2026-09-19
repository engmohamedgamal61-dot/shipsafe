import { describe, expect, it } from "vitest";
import type { AgentReviewOutput } from "@/domain/schemas";
import type { ReviewContext } from "../types";
import type { AgentReviewInput, AgentReviewResult, AIProvider } from "../providers/provider";
import { TEST_REVIEWER_INSTRUCTIONS, TestReviewerAgent } from "./test-reviewer";

function context(overrides: Partial<ReviewContext> = {}): ReviewContext {
  return {
    pullRequestTitle: "Add feature",
    sourceBranch: "feature",
    targetBranch: "main",
    changedFiles: [{ path: "score.test.ts", status: "modified", additions: 1, deletions: 0 }],
    diffText: "diff --git a/score.test.ts b/score.test.ts\n+++ b/score.test.ts\n@@ -0,0 +1,1 @@\n+it('x', () => {});",
    diffTruncated: false,
    changedFilesTruncated: false,
    ...overrides,
  };
}

class StubProvider implements AIProvider {
  public lastInput: AgentReviewInput | null = null;
  constructor(private readonly output: AgentReviewOutput) {}

  async review(input: AgentReviewInput): Promise<AgentReviewResult> {
    this.lastInput = input;
    return {
      output: this.output,
      metadata: { provider: "stub", model: "stub", requestId: null, inputTokens: null, outputTokens: null, latencyMs: 0, attempt: input.attempt },
    };
  }
}

describe("TEST_REVIEWER_INSTRUCTIONS content (tuning pass after the first real baseline)", () => {
  it("states no speculative coverage-gap invention", () => {
    expect(TEST_REVIEWER_INSTRUCTIONS).toMatch(/do not invent speculative coverage gaps/i);
    expect(TEST_REVIEWER_INSTRUCTIONS).toMatch(/evaluate demonstrated risk in this diff, not an exhaustive wish list/i);
  });

  it("states ambiguity/unseen-test discipline", () => {
    expect(TEST_REVIEWER_INSTRUCTIONS).toMatch(/never use medium or high confidence while your own description acknowledges/i);
  });

  it("states the one-root-cause-one-finding rule", () => {
    expect(TEST_REVIEWER_INSTRUCTIONS).toMatch(/one root cause, one finding/i);
  });

  it("states category discipline with the benchmark's own canonical category strings", () => {
    expect(TEST_REVIEWER_INSTRUCTIONS).toContain("async-mistakes.missing-await");
    expect(TEST_REVIEWER_INSTRUCTIONS).toContain("mock-fidelity.hides-real-contract");
  });

  it("states evidence precision: no hypothetical API calls, no multiple examples in one backtick span", () => {
    expect(TEST_REVIEWER_INSTRUCTIONS).toMatch(/never quote a hypothetical real-integration api call/i);
    expect(TEST_REVIEWER_INSTRUCTIONS).toMatch(/never put multiple illustrative examples inside one set of backticks/i);
  });

  it("states reviewer lane discipline", () => {
    expect(TEST_REVIEWER_INSTRUCTIONS).toMatch(/do not report an ordinary production-code correctness bug, a security finding, an architecture concern, or a database design concern/i);
  });

  it("states severity calibration", () => {
    expect(TEST_REVIEWER_INSTRUCTIONS).toMatch(/reserve p0\/p1 for test gaps that can realistically allow a severe behavior regression/i);
  });
});

describe("TestReviewerAgent", () => {
  it("passes TEST_REVIEWER_INSTRUCTIONS to the provider unchanged", async () => {
    const provider = new StubProvider({ summary: "ok", findings: [] });
    const agent = new TestReviewerAgent(provider);
    await agent.review(context(), 1);
    expect(provider.lastInput?.instructions).toBe(TEST_REVIEWER_INSTRUCTIONS);
    expect(provider.lastInput?.reviewer).toBe("test");
  });

  it("applies test normalization (lane discipline, dedup) to the provider's raw output before returning it", async () => {
    const provider = new StubProvider({
      summary: "found stuff",
      findings: [
        {
          severity: "P1",
          title: "Real finding",
          description: "The rejects assertion is used without await, so the test always reports passing.",
          filePath: "score.test.ts",
          lineStart: 1,
          lineEnd: 1,
          category: "testing",
          recommendation: "Fix it.",
          confidence: 0.9,
        },
        {
          severity: "P2",
          title: "Out of lane",
          description: "This production function has an off-by-one bug.",
          filePath: "score.test.ts",
          lineStart: 1,
          lineEnd: 1,
          category: "correctness",
          recommendation: "N/A",
          confidence: 0.5,
        },
      ],
    });
    const agent = new TestReviewerAgent(provider);
    const result = await agent.review(context(), 1);

    expect(result.output.findings).toHaveLength(1);
    expect(result.output.findings[0]?.category).toBe("async-mistakes.missing-await");
  });

  it("preserves provider metadata untouched", async () => {
    const provider = new StubProvider({ summary: "ok", findings: [] });
    const agent = new TestReviewerAgent(provider);
    const result = await agent.review(context(), 3);
    expect(result.metadata.attempt).toBe(3);
  });
});
