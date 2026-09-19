import { describe, expect, it } from "vitest";
import type { AgentReviewOutput } from "@/domain/schemas";
import type { ReviewContext } from "../types";
import type { AgentReviewInput, AgentReviewResult, AIProvider } from "../providers/provider";
import { SECURITY_REVIEWER_INSTRUCTIONS, SecurityReviewerAgent } from "./security-reviewer";

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

describe("SECURITY_REVIEWER_INSTRUCTIONS content (Tasks 1-5 of the tuning pass)", () => {
  it("states the evidence-sufficiency rule: absence of hardening is not a vulnerability, and safe code should produce no finding", () => {
    expect(SECURITY_REVIEWER_INSTRUCTIONS).toMatch(/absence of a hardening measure.*best practice.*defense-in-depth.*not itself a vulnerability/i);
    expect(SECURITY_REVIEWER_INSTRUCTIONS).toMatch(/do not assume, infer, or guess at surrounding infrastructure/i);
  });

  it("states the ambiguity rule: uncertain evidence must not become a confident, high-severity finding", () => {
    expect(SECURITY_REVIEWER_INSTRUCTIONS).toMatch(/do not report a confident, high-severity finding/i);
    expect(SECURITY_REVIEWER_INSTRUCTIONS).toMatch(/never resolve uncertainty by assuming the worst case/i);
  });

  it("does NOT contain the RLS-specific evidence-sufficiency clarification (Variant A of the controlled ablation) — it did not fix injection-02 cleanly (still produced a hedged-but-present finding, still failing this safe fixture's zero-tolerance rule) and coincided with a fabricated-evidence hard failure on llm-ai-01 in its only live sample. Reverted; see docs/agents/security-baseline-current.md's ablation addendum for the full before/after", () => {
    expect(SECURITY_REVIEWER_INSTRUCTIONS).not.toMatch(/row-level authorization/i);
    expect(SECURITY_REVIEWER_INSTRUCTIONS).not.toContain("SECURITY DEFINER function that skips it");
  });

  it("states that unconfirmed reachability specifically requires confidence 'low', not 'medium' — kept after the controlled ablation: Variant B (this clarification alone, without the RLS one) held 100% recall/P0/P1 recall, 0% duplicate/fabricated-evidence rate, and cleanly fixed both multi-tenant-04 AND llm-ai-01 in its live run (regression: multi-tenant-04's real baseline run wrote explicit reachability-hedging language — 'not certain', 'no call sites' — but still assigned 'medium' confidence)", () => {
    expect(SECURITY_REVIEWER_INSTRUCTIONS).toMatch(/no call site, no route, no invocation, no grant\/permission statement/i);
    expect(SECURITY_REVIEWER_INSTRUCTIONS).toMatch(/use confidence 'low', not 'medium'/i);
    expect(SECURITY_REVIEWER_INSTRUCTIONS).toMatch(/unconfirmed reachability is a precondition for exploitability, not a minor caveat/i);
  });

  it("states the one-root-cause-one-finding rule, but explicitly warns against merging a causal CHAIN of distinct defects into one finding (regression: llm-ai-01's real baseline run merged prompt-injection and unsafe-tool-use into a single finding, dropping P1 recall to 50%)", () => {
    expect(SECURITY_REVIEWER_INSTRUCTIONS).toMatch(/one root cause, one finding/i);
    expect(SECURITY_REVIEWER_INSTRUCTIONS).toMatch(/do not merge two genuinely distinct defects/i);
    expect(SECURITY_REVIEWER_INSTRUCTIONS).toMatch(/even though they're part of the same attack chain/i);
    expect(SECURITY_REVIEWER_INSTRUCTIONS).toMatch(/must remain two separate findings whenever each is independently evidenced/i);
  });

  it("states category discipline and explicitly forbids process/code-quality categories", () => {
    expect(SECURITY_REVIEWER_INSTRUCTIONS).toMatch(/category discipline/i);
    expect(SECURITY_REVIEWER_INSTRUCTIONS).toContain("code-review-process");
  });

  it("states the evidence-anchoring rule: exact quotes, not ellipsis paraphrases or comments, and allows a multi-line contiguous span", () => {
    expect(SECURITY_REVIEWER_INSTRUCTIONS).toMatch(/never to a comment that only describes or acknowledges the issue/i);
    expect(SECURITY_REVIEWER_INSTRUCTIONS).toMatch(/never paraphrase with an ellipsis when you can quote it exactly/i);
    expect(SECURITY_REVIEWER_INSTRUCTIONS).toMatch(/this may be more than one line when the vulnerable operation itself spans multiple lines/i);
  });

  it("states the evidence-anchoring rule explicitly forbids anchoring to a function signature just because it's easier to quote (regression: llm-ai-01 cited the function declaration instead of the vulnerable line)", () => {
    expect(SECURITY_REVIEWER_INSTRUCTIONS).toMatch(/never to an earlier declaration or function signature just because it's easier to quote/i);
    expect(SECURITY_REVIEWER_INSTRUCTIONS).toMatch(/anchor to the line\(s\) where the actual dangerous operation happens/i);
  });
});

describe("SecurityReviewerAgent", () => {
  it("passes SECURITY_REVIEWER_INSTRUCTIONS to the provider unchanged", async () => {
    const provider = new StubProvider({ summary: "ok", findings: [] });
    const agent = new SecurityReviewerAgent(provider);
    await agent.review(context(), 1);
    expect(provider.lastInput?.instructions).toBe(SECURITY_REVIEWER_INSTRUCTIONS);
    expect(provider.lastInput?.reviewer).toBe("security");
  });

  it("applies security normalization (category drop, evidence redaction, dedup) to the provider's raw output before returning it", async () => {
    const provider = new StubProvider({
      summary: "found stuff",
      findings: [
        {
          severity: "P0",
          title: "Real finding",
          description: "Uses `const x = 1;` verbatim.",
          filePath: "route.ts",
          lineStart: 1,
          lineEnd: 1,
          category: "access-control",
          recommendation: "Fix it.",
          confidence: 0.9,
        },
        {
          severity: "NIT",
          title: "Meta commentary",
          description: "This looks fine.",
          filePath: null,
          lineStart: null,
          lineEnd: null,
          category: "code-review-process",
          recommendation: "N/A",
          confidence: 0.5,
        },
      ],
    });
    const agent = new SecurityReviewerAgent(provider);
    const result = await agent.review(context(), 1);

    // The non-security category is gone; the real finding survives.
    expect(result.output.findings).toHaveLength(1);
    expect(result.output.findings[0]?.category).toBe("access-control");
  });

  it("preserves provider metadata untouched", async () => {
    const provider = new StubProvider({ summary: "ok", findings: [] });
    const agent = new SecurityReviewerAgent(provider);
    const result = await agent.review(context(), 3);
    expect(result.metadata.attempt).toBe(3);
  });
});
