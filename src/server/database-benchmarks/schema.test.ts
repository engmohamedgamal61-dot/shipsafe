import { describe, expect, it } from "vitest";
import { categorySchema, expectedFixtureSchema, ruleIdSchema } from "./schema";

function baseFixture(overrides: Record<string, unknown> = {}): unknown {
  return {
    fixture_id: "foreign-keys-01-test",
    domain: "foreign-keys",
    tags: ["buggy"],
    description: "x",
    files: ["migration.sql"],
    expected: {
      needs_more_context_acceptable: false,
      allowed_categories: ["foreign-keys.missing-reference"],
      prohibited_categories: [],
      required_findings: [
        {
          id: "req-1",
          rule_id: "DB-FOREIGNKEYS-001",
          files: ["migration.sql"],
          line_ranges: { "migration.sql": [5, 5] },
          severity_range: ["P1", "P1"],
          confidence_range: ["medium", "high"],
          justification: "j",
          category: "foreign-keys.missing-reference",
        },
      ],
      optional_findings: [],
    },
    ...overrides,
  };
}

describe("categorySchema", () => {
  it("accepts canonical domain.subcategory format", () => {
    expect(categorySchema.safeParse("foreign-keys.missing-reference").success).toBe(true);
  });

  it("rejects a bare, non-dotted category", () => {
    expect(categorySchema.safeParse("foreign-keys").success).toBe(false);
  });
});

describe("ruleIdSchema", () => {
  it("accepts the DB-<DOMAIN>-NNN format", () => {
    expect(ruleIdSchema.safeParse("DB-FOREIGNKEYS-001").success).toBe(true);
  });

  it("rejects the code-benchmark's own CODE- prefix", () => {
    expect(ruleIdSchema.safeParse("CODE-FOREIGNKEYS-001").success).toBe(false);
  });
});

describe("expectedFixtureSchema", () => {
  it("accepts a well-formed buggy fixture", () => {
    expect(expectedFixtureSchema.safeParse(baseFixture()).success).toBe(true);
  });

  it("rejects a required-finding file not in the top-level files list", () => {
    const fixture = baseFixture();
    (fixture as { expected: { required_findings: Array<{ files: string[] }> } }).expected.required_findings[0].files = ["other.sql"];
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
      rule_id: "DB-FOREIGNKEYS-002",
      files: ["migration.sql"],
      line_ranges: { "migration.sql": [5, 5] },
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
            rule_id: "DB-AMBIGUOUS-001",
            files: ["migration.sql"],
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
