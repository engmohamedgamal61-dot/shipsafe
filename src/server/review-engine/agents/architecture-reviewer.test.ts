import { describe, expect, it } from "vitest";
import type { AgentReviewOutput } from "@/domain/schemas";
import type { ReviewContext } from "../types";
import type { AgentReviewInput, AgentReviewResult, AIProvider } from "../providers/provider";
import { ARCHITECTURE_REVIEWER_INSTRUCTIONS, ArchitectureReviewerAgent } from "./architecture-reviewer";

function context(overrides: Partial<ReviewContext> = {}): ReviewContext {
  return {
    pullRequestTitle: "Add feature",
    sourceBranch: "feature",
    targetBranch: "main",
    changedFiles: [{ path: "supabase-adapter.ts", status: "modified", additions: 1, deletions: 0 }],
    diffText: "diff --git a/supabase-adapter.ts b/supabase-adapter.ts\n+++ b/supabase-adapter.ts\n@@ -0,0 +1,1 @@\n+export const x = 1;",
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

describe("ARCHITECTURE_REVIEWER_INSTRUCTIONS content (tuning pass after the first real baseline)", () => {
  it("states reviewer lane discipline: no security/testing/correctness/style findings", () => {
    expect(ARCHITECTURE_REVIEWER_INSTRUCTIONS).toMatch(/do not report security or access-control issues, missing tests, missing try\/catch/i);
  });

  it("states no hypothetical scale/future-risk invention, with the TTL-cache example", () => {
    expect(ARCHITECTURE_REVIEWER_INSTRUCTIONS).toMatch(/a ttl cache is not defective merely because/i);
  });

  it("states the one-root-cause-one-finding rule", () => {
    expect(ARCHITECTURE_REVIEWER_INSTRUCTIONS).toMatch(/one root cause, one finding/i);
  });

  it("states category discipline with the benchmark's own canonical category strings", () => {
    expect(ARCHITECTURE_REVIEWER_INSTRUCTIONS).toContain("layer-boundaries.cross-layer-import");
    expect(ARCHITECTURE_REVIEWER_INSTRUCTIONS).toContain("provider-leakage.vendor-type-in-domain");
  });

  it("states evidence precision: no ellipsis-abbreviated quotes", () => {
    expect(ARCHITECTURE_REVIEWER_INSTRUCTIONS).toMatch(/never use an ellipsis-abbreviated stand-in for a real call/i);
  });

  it("states ambiguity/confidence calibration", () => {
    expect(ARCHITECTURE_REVIEWER_INSTRUCTIONS).toMatch(/never use medium or high confidence while your own description acknowledges this uncertainty/i);
  });

  it("states severity calibration reserving P0 for catastrophic impact", () => {
    expect(ARCHITECTURE_REVIEWER_INSTRUCTIONS).toMatch(/reserve p0 for genuinely severe architectural breakage/i);
  });
});

describe("ArchitectureReviewerAgent", () => {
  it("passes ARCHITECTURE_REVIEWER_INSTRUCTIONS to the provider unchanged", async () => {
    const provider = new StubProvider({ summary: "ok", findings: [] });
    const agent = new ArchitectureReviewerAgent(provider);
    await agent.review(context(), 1);
    expect(provider.lastInput?.instructions).toBe(ARCHITECTURE_REVIEWER_INSTRUCTIONS);
    expect(provider.lastInput?.reviewer).toBe("architecture");
  });

  it("applies architecture normalization (lane discipline, dedup) to the provider's raw output before returning it", async () => {
    const provider = new StubProvider({
      summary: "found stuff",
      findings: [
        {
          severity: "P1",
          title: "Real finding",
          description: "The repository imports RepositoryCard, a UI component, into the persistence layer.",
          filePath: "supabase-adapter.ts",
          lineStart: 1,
          lineEnd: 1,
          category: "architecture",
          recommendation: "Fix it.",
          confidence: 0.9,
        },
        {
          severity: "P2",
          title: "Out of lane",
          description: "This PR adds new exported functions but includes no unit tests.",
          filePath: "supabase-adapter.ts",
          lineStart: 1,
          lineEnd: 1,
          category: "testing",
          recommendation: "N/A",
          confidence: 0.5,
        },
      ],
    });
    const agent = new ArchitectureReviewerAgent(provider);
    const result = await agent.review(context(), 1);

    expect(result.output.findings).toHaveLength(1);
    expect(result.output.findings[0]?.category).toBe("layer-boundaries.cross-layer-import");
  });

  it("preserves provider metadata untouched", async () => {
    const provider = new StubProvider({ summary: "ok", findings: [] });
    const agent = new ArchitectureReviewerAgent(provider);
    const result = await agent.review(context(), 3);
    expect(result.metadata.attempt).toBe(3);
  });
});
