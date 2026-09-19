import { describe, expect, it } from "vitest";
import type { ExpectedJudgeFixture } from "../schema";
import { allFindingsFromFixture, buildReviewerRunsFromFixture } from "./context";

function fixture(overrides: Partial<ExpectedJudgeFixture> = {}): { manifest: ExpectedJudgeFixture; fixtureDir: string } {
  const manifest: ExpectedJudgeFixture = {
    fixture_id: "f1",
    domain: "test",
    tags: ["clean"],
    description: "d",
    reviewer_runs: [
      { reviewer: "code", status: "complete", summary: "ok", findings: [] },
      {
        reviewer: "security",
        status: "complete",
        summary: "found one",
        findings: [{ id: "sec-1", severity: "P1", title: "t", description: "d", category: "c", recommendation: "r", confidence: 0.9, filePath: "a.ts", lineStart: 3, lineEnd: 3 }],
      },
    ],
    expected: {
      verdict: "APPROVE_WITH_MINOR_FIXES",
      rationale: "r",
      blocking_finding_ids: [],
      duplicate_groups: [],
      low_confidence_only_finding_ids: [],
      requires_full_reviewer_coverage: true,
      hallucination_probe_terms: [],
    },
    ...overrides,
  };
  return { manifest, fixtureDir: "/fake" };
}

describe("buildReviewerRunsFromFixture", () => {
  it("produces one ReviewerRun per fixture reviewer_run, preserving reviewer/status/summary", () => {
    const runs = buildReviewerRunsFromFixture(fixture());
    expect(runs).toHaveLength(2);
    expect(runs[0].reviewer).toBe("code");
    expect(runs[1].reviewer).toBe("security");
    expect(runs[1].summary).toBe("found one");
  });

  it("carries every finding field through, filling in id/reviewerRunId scaffolding", () => {
    const runs = buildReviewerRunsFromFixture(fixture());
    const [finding] = runs[1].findings;
    expect(finding.id).toBe("sec-1");
    expect(finding.reviewerRunId).toBe(runs[1].id);
    expect(finding.severity).toBe("P1");
    expect(finding.filePath).toBe("a.ts");
  });

  it("sets errorMessage for a failed reviewer run and null for a complete one", () => {
    const withFailure = fixture({
      reviewer_runs: [{ reviewer: "test", status: "failed", summary: null, findings: [] }],
      expected: { ...fixture().manifest.expected, verdict: "DO_NOT_APPROVE", requires_full_reviewer_coverage: false },
    });
    const runs = buildReviewerRunsFromFixture(withFailure);
    expect(runs[0].errorMessage).not.toBeNull();
  });
});

describe("allFindingsFromFixture", () => {
  it("flattens findings across all reviewer runs", () => {
    expect(allFindingsFromFixture(fixture())).toHaveLength(1);
  });
});
