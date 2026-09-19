import { describe, expect, it } from "vitest";
import type { AgentReviewOutput } from "@/domain/schemas";
import type { ReviewContext } from "../types";
import type { AgentReviewInput, AgentReviewResult, AIProvider } from "../providers/provider";
import { CODE_REVIEWER_INSTRUCTIONS, CodeReviewerAgent } from "./code-reviewer";

function context(overrides: Partial<ReviewContext> = {}): ReviewContext {
  return {
    pullRequestTitle: "Add feature",
    sourceBranch: "feature",
    targetBranch: "main",
    changedFiles: [{ path: "route.ts", status: "modified", additions: 1, deletions: 0 }],
    diffText: "diff --git a/route.ts b/route.ts\n+++ b/route.ts\n@@ -0,0 +1,1 @@\n+const x = 1;",
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

describe("CODE_REVIEWER_INSTRUCTIONS content (tuning pass after the first real baseline)", () => {
  it("states the evidence-precision rule: literal quotes only, no computed values or ellipsis paraphrases", () => {
    expect(CODE_REVIEWER_INSTRUCTIONS).toMatch(/must be literal source text/i);
    expect(CODE_REVIEWER_INSTRUCTIONS).toMatch(/never put a computed or derived value/i);
    expect(CODE_REVIEWER_INSTRUCTIONS).toMatch(/ellipsis-abbreviated stand-in for a longer call/i);
    expect(CODE_REVIEWER_INSTRUCTIONS).toMatch(/do not pretend a description is a literal quote/i);
  });

  it("states the one-root-cause-one-finding rule", () => {
    expect(CODE_REVIEWER_INSTRUCTIONS).toMatch(/one root cause, one finding/i);
    expect(CODE_REVIEWER_INSTRUCTIONS).toMatch(/prefer merging them/i);
  });

  it("states current-code-only discipline and distinguishes it from current-state edge cases", () => {
    expect(CODE_REVIEWER_INSTRUCTIONS).toMatch(/a future source change/i);
    expect(CODE_REVIEWER_INSTRUCTIONS).toMatch(/is not a current defect; do not report it/i);
    expect(CODE_REVIEWER_INSTRUCTIONS).toMatch(/those ARE current defects and should be reported/i);
  });

  it("states ambiguity/confidence calibration: never medium/high confidence while acknowledging unknown behavior", () => {
    expect(CODE_REVIEWER_INSTRUCTIONS).toMatch(/never use medium or high confidence while your own description acknowledges/i);
  });

  it("states reviewer lane discipline: no security categories", () => {
    expect(CODE_REVIEWER_INSTRUCTIONS).toMatch(/never use a security-oriented category/i);
    expect(CODE_REVIEWER_INSTRUCTIONS).toMatch(/a separate Security Reviewer already covers that ground/i);
  });
});

describe("CodeReviewerAgent", () => {
  it("passes CODE_REVIEWER_INSTRUCTIONS to the provider unchanged", async () => {
    const provider = new StubProvider({ summary: "ok", findings: [] });
    const agent = new CodeReviewerAgent(provider);
    await agent.review(context(), 1);
    expect(provider.lastInput?.instructions).toBe(CODE_REVIEWER_INSTRUCTIONS);
    expect(provider.lastInput?.reviewer).toBe("code");
  });

  it("applies code normalization (lane discipline, evidence redaction, dedup) to the provider's raw output before returning it", async () => {
    const provider = new StubProvider({
      summary: "found stuff",
      findings: [
        {
          severity: "P1",
          title: "Real finding",
          description: "Uses `const x = 1;` verbatim.",
          filePath: "route.ts",
          lineStart: 1,
          lineEnd: 1,
          category: "correctness",
          recommendation: "Fix it.",
          confidence: 0.9,
        },
        {
          severity: "P2",
          title: "Out of lane",
          description: "This parameter should be sanitized against injection.",
          filePath: "route.ts",
          lineStart: 1,
          lineEnd: 1,
          category: "security",
          recommendation: "N/A",
          confidence: 0.5,
        },
      ],
    });
    const agent = new CodeReviewerAgent(provider);
    const result = await agent.review(context(), 1);

    expect(result.output.findings).toHaveLength(1);
    expect(result.output.findings[0]?.category).toBe("correctness");
  });

  it("preserves provider metadata untouched", async () => {
    const provider = new StubProvider({ summary: "ok", findings: [] });
    const agent = new CodeReviewerAgent(provider);
    const result = await agent.review(context(), 3);
    expect(result.metadata.attempt).toBe(3);
  });
});
