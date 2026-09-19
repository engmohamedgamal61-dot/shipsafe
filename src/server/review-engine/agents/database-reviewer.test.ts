import { describe, expect, it } from "vitest";
import type { AgentReviewOutput } from "@/domain/schemas";
import type { ReviewContext } from "../types";
import type { AgentReviewInput, AgentReviewResult, AIProvider } from "../providers/provider";
import { DATABASE_REVIEWER_INSTRUCTIONS, DatabaseReviewerAgent } from "./database-reviewer";

function context(overrides: Partial<ReviewContext> = {}): ReviewContext {
  return {
    pullRequestTitle: "Add feature",
    sourceBranch: "feature",
    targetBranch: "main",
    changedFiles: [{ path: "migration.sql", status: "added", additions: 1, deletions: 0 }],
    diffText: "diff --git a/migration.sql b/migration.sql\n+++ b/migration.sql\n@@ -0,0 +1,1 @@\n+create table public.x (id uuid);",
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

describe("DATABASE_REVIEWER_INSTRUCTIONS content (tuning pass after the first real baseline)", () => {
  it("states reviewer lane discipline: no RLS/tenant-isolation/security findings", () => {
    expect(DATABASE_REVIEWER_INSTRUCTIONS).toMatch(/do not emit rls, tenant-isolation, authentication, authorization, or generic security findings/i);
    expect(DATABASE_REVIEWER_INSTRUCTIONS).toMatch(/omit it entirely/i);
  });

  it("states the one-root-cause-one-finding rule", () => {
    expect(DATABASE_REVIEWER_INSTRUCTIONS).toMatch(/one root cause, one finding/i);
  });

  it("states evidence precision: no hypothetical SQL quotes, no inferred response fields", () => {
    expect(DATABASE_REVIEWER_INSTRUCTIONS).toMatch(/never quote a hypothetical sql statement as if it exists/i);
    expect(DATABASE_REVIEWER_INSTRUCTIONS).toMatch(/never quote an inferred field or response property/i);
  });

  it("states ambiguity/confidence calibration for unseen production context", () => {
    expect(DATABASE_REVIEWER_INSTRUCTIONS).toMatch(/production context this diff cannot show/i);
    expect(DATABASE_REVIEWER_INSTRUCTIONS).toMatch(/never use medium or high confidence while your own description acknowledges/i);
  });

  it("states category specificity with the benchmark's own canonical category strings", () => {
    expect(DATABASE_REVIEWER_INSTRUCTIONS).toContain("foreign-keys.missing-reference");
    expect(DATABASE_REVIEWER_INSTRUCTIONS).toContain("transaction-boundary.non-atomic-multi-step-write");
  });

  it("states severity calibration", () => {
    expect(DATABASE_REVIEWER_INSTRUCTIONS).toMatch(/reserve p0\/p1 for defects with clear data-loss/i);
  });
});

describe("DatabaseReviewerAgent", () => {
  it("passes DATABASE_REVIEWER_INSTRUCTIONS to the provider unchanged", async () => {
    const provider = new StubProvider({ summary: "ok", findings: [] });
    const agent = new DatabaseReviewerAgent(provider);
    await agent.review(context(), 1);
    expect(provider.lastInput?.instructions).toBe(DATABASE_REVIEWER_INSTRUCTIONS);
    expect(provider.lastInput?.reviewer).toBe("database");
  });

  it("applies database normalization (lane discipline, dedup) to the provider's raw output before returning it", async () => {
    const provider = new StubProvider({
      summary: "found stuff",
      findings: [
        {
          severity: "P1",
          title: "Real finding",
          description: "The table lacks a foreign key reference to public.repositories.",
          filePath: "migration.sql",
          lineStart: 1,
          lineEnd: 1,
          category: "data-integrity",
          recommendation: "Fix it.",
          confidence: 0.9,
        },
        {
          severity: "P2",
          title: "Out of lane",
          description: "This table has no row level security policies.",
          filePath: "migration.sql",
          lineStart: 1,
          lineEnd: 1,
          category: "security",
          recommendation: "N/A",
          confidence: 0.5,
        },
      ],
    });
    const agent = new DatabaseReviewerAgent(provider);
    const result = await agent.review(context(), 1);

    expect(result.output.findings).toHaveLength(1);
    expect(result.output.findings[0]?.category).toBe("foreign-keys.missing-reference");
  });

  it("preserves provider metadata untouched", async () => {
    const provider = new StubProvider({ summary: "ok", findings: [] });
    const agent = new DatabaseReviewerAgent(provider);
    const result = await agent.review(context(), 3);
    expect(result.metadata.attempt).toBe(3);
  });
});
