import { describe, expect, it } from "vitest";
import { expectedJudgeFixtureSchema } from "./schema";

function baseFixture(overrides: Record<string, unknown> = {}) {
  return {
    fixture_id: "clean-01",
    domain: "clean",
    tags: ["clean"],
    description: "A clean release.",
    reviewer_runs: (["code", "security", "architecture", "database", "test"] as const).map((reviewer) => ({
      reviewer,
      status: "complete",
      summary: "No issues found.",
      findings: [],
    })),
    expected: {
      verdict: "APPROVE",
      rationale: "No findings from any reviewer.",
      blocking_finding_ids: [],
      duplicate_groups: [],
      low_confidence_only_finding_ids: [],
      requires_full_reviewer_coverage: true,
      hallucination_probe_terms: [],
    },
    ...overrides,
  };
}

describe("expectedJudgeFixtureSchema", () => {
  it("accepts a valid clean fixture", () => {
    expect(expectedJudgeFixtureSchema.safeParse(baseFixture()).success).toBe(true);
  });

  it("rejects a finding id referenced in blocking_finding_ids that doesn't exist", () => {
    const fixture = baseFixture({
      tags: ["confirmed-blocker"],
      reviewer_runs: [{ reviewer: "security", status: "complete", summary: "s", findings: [] }, ...baseFixture().reviewer_runs.slice(1)],
      expected: { ...baseFixture().expected, verdict: "DO_NOT_APPROVE", blocking_finding_ids: ["does-not-exist"] },
    });
    const result = expectedJudgeFixtureSchema.safeParse(fixture);
    expect(result.success).toBe(false);
  });

  it("rejects duplicate finding ids across reviewer_runs", () => {
    const runs = baseFixture().reviewer_runs.map((r: Record<string, unknown>, i: number) =>
      i < 2 ? { ...r, findings: [{ id: "dup", severity: "P1", title: "t", description: "d", category: "c", recommendation: "r", confidence: 0.9 }] } : r,
    );
    const fixture = baseFixture({ reviewer_runs: runs });
    expect(expectedJudgeFixtureSchema.safeParse(fixture).success).toBe(false);
  });

  it("rejects a clean-tagged fixture that has findings", () => {
    const runs = baseFixture().reviewer_runs.map((r: Record<string, unknown>, i: number) =>
      i === 0 ? { ...r, findings: [{ id: "f1", severity: "P2", title: "t", description: "d", category: "c", recommendation: "r", confidence: 0.9 }] } : r,
    );
    const fixture = baseFixture({ reviewer_runs: runs });
    expect(expectedJudgeFixtureSchema.safeParse(fixture).success).toBe(false);
  });

  it("rejects requires_full_reviewer_coverage=true when a required reviewer is missing", () => {
    const fixture = baseFixture({ reviewer_runs: baseFixture().reviewer_runs.filter((r: Record<string, unknown>) => r.reviewer !== "test") });
    expect(expectedJudgeFixtureSchema.safeParse(fixture).success).toBe(false);
  });

  it("requires DO_NOT_APPROVE when required-reviewer coverage is incomplete", () => {
    const fixture = baseFixture({
      reviewer_runs: [
        ...baseFixture().reviewer_runs.filter((r: Record<string, unknown>) => r.reviewer !== "test"),
        { reviewer: "test", status: "failed", summary: null, findings: [] },
      ],
      expected: { ...baseFixture().expected, verdict: "APPROVE", requires_full_reviewer_coverage: false },
    });
    expect(expectedJudgeFixtureSchema.safeParse(fixture).success).toBe(false);
  });

  it("accepts a failed-reviewer fixture expecting DO_NOT_APPROVE", () => {
    const fixture = baseFixture({
      tags: ["failed-reviewer"],
      reviewer_runs: [
        ...baseFixture().reviewer_runs.filter((r: Record<string, unknown>) => r.reviewer !== "test"),
        { reviewer: "test", status: "failed", summary: null, findings: [] },
      ],
      expected: { ...baseFixture().expected, verdict: "DO_NOT_APPROVE", requires_full_reviewer_coverage: false },
    });
    expect(expectedJudgeFixtureSchema.safeParse(fixture).success).toBe(true);
  });

  it("rejects duplicate_groups referencing a finding id that doesn't exist", () => {
    const fixture = baseFixture({
      expected: { ...baseFixture().expected, duplicate_groups: [["missing-a", "missing-b"]] },
    });
    expect(expectedJudgeFixtureSchema.safeParse(fixture).success).toBe(false);
  });
});
