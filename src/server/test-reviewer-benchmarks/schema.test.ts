import { describe, expect, it } from "vitest";
import { categorySchema, expectedFixtureSchema, ruleIdSchema } from "./schema";

function baseFixture(overrides: Record<string, unknown> = {}): unknown {
  return {
    fixture_id: "missing-tests-01-test",
    domain: "missing-tests",
    tags: ["buggy"],
    description: "x",
    files: ["verdict.ts"],
    expected: {
      needs_more_context_acceptable: false,
      allowed_categories: ["missing-tests.critical-behavior"],
      prohibited_categories: [],
      required_findings: [
        {
          id: "req-1",
          rule_id: "TEST-MISSINGTESTS-001",
          files: ["verdict.ts"],
          line_ranges: { "verdict.ts": [1, 5] },
          severity_range: ["P1", "P1"],
          confidence_range: ["medium", "high"],
          justification: "j",
          category: "missing-tests.critical-behavior",
        },
      ],
      optional_findings: [],
    },
    ...overrides,
  };
}

describe("categorySchema", () => {
  it("accepts canonical domain.subcategory format", () => {
    expect(categorySchema.safeParse("missing-tests.critical-behavior").success).toBe(true);
  });

  it("rejects a bare, non-dotted category", () => {
    expect(categorySchema.safeParse("missing-tests").success).toBe(false);
  });
});

describe("ruleIdSchema", () => {
  it("accepts the TEST-<DOMAIN>-NNN format", () => {
    expect(ruleIdSchema.safeParse("TEST-MISSINGTESTS-001").success).toBe(true);
  });

  it("rejects the architecture-benchmark's own ARCH- prefix", () => {
    expect(ruleIdSchema.safeParse("ARCH-MISSINGTESTS-001").success).toBe(false);
  });
});

describe("expectedFixtureSchema", () => {
  it("accepts a well-formed buggy fixture", () => {
    expect(expectedFixtureSchema.safeParse(baseFixture()).success).toBe(true);
  });

  it("accepts a multi-file fixture", () => {
    const fixture = baseFixture({
      files: ["score.test.ts", "score.ts"],
      expected: {
        needs_more_context_acceptable: false,
        allowed_categories: ["missing-error-path.untested-failure-mode"],
        prohibited_categories: [],
        required_findings: [
          {
            id: "req-1",
            rule_id: "TEST-MISSINGERRORPATH-001",
            files: ["score.test.ts"],
            line_ranges: { "score.test.ts": [4, 8] },
            severity_range: ["P1", "P1"],
            confidence_range: ["medium", "high"],
            justification: "j",
            category: "missing-error-path.untested-failure-mode",
          },
        ],
        optional_findings: [],
      },
    });
    expect(expectedFixtureSchema.safeParse(fixture).success).toBe(true);
  });

  it("rejects a required-finding file not in the top-level files list", () => {
    const fixture = baseFixture();
    (fixture as { expected: { required_findings: Array<{ files: string[] }> } }).expected.required_findings[0].files = ["other.ts"];
    expect(expectedFixtureSchema.safeParse(fixture).success).toBe(false);
  });

  it("rejects an ambiguous fixture that has required_findings", () => {
    const fixture = baseFixture();
    (fixture as { expected: { needs_more_context_acceptable: boolean } }).expected.needs_more_context_acceptable = true;
    expect(expectedFixtureSchema.safeParse(fixture).success).toBe(false);
  });

  it("rejects a safe fixture that has any findings", () => {
    const fixture = baseFixture({ tags: ["safe"] });
    expect(expectedFixtureSchema.safeParse(fixture).success).toBe(false);
  });

  it("accepts a safe fixture with zero findings", () => {
    const fixture = baseFixture({
      tags: ["safe"],
      expected: { needs_more_context_acceptable: false, allowed_categories: [], prohibited_categories: [], required_findings: [], optional_findings: [] },
    });
    expect(expectedFixtureSchema.safeParse(fixture).success).toBe(true);
  });

  it("rejects two overlapping ground-truth entries with no disjoint category set", () => {
    const fixture = baseFixture();
    (fixture as { expected: { required_findings: Array<Record<string, unknown>> } }).expected.required_findings.push({
      id: "req-2",
      rule_id: "TEST-MISSINGTESTS-002",
      files: ["verdict.ts"],
      line_ranges: { "verdict.ts": [1, 5] },
      severity_range: ["P2", "P2"],
      confidence_range: ["medium", "medium"],
      justification: "j2",
      // no category — overlaps req-1's location with no disambiguation
    });
    expect(expectedFixtureSchema.safeParse(fixture).success).toBe(false);
  });

  it("rejects an ambiguous fixture whose optional finding allows non-low confidence", () => {
    const fixture = baseFixture({
      expected: {
        needs_more_context_acceptable: true,
        allowed_categories: [],
        prohibited_categories: [],
        required_findings: [],
        optional_findings: [
          {
            id: "opt-1",
            rule_id: "TEST-AMBIGUOUS-001",
            files: ["verdict.ts"],
            severity_range: ["P2", "P2"],
            confidence_range: ["low", "medium"],
            justification: "j",
          },
        ],
      },
    });
    expect(expectedFixtureSchema.safeParse(fixture).success).toBe(false);
  });
});
