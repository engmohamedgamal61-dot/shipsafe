import { describe, expect, it } from "vitest";
import { categorySchema, expectedFixtureSchema, ruleIdSchema } from "./schema";

function baseFixture(overrides: Record<string, unknown> = {}): unknown {
  return {
    fixture_id: "layer-boundaries-01-test",
    domain: "layer-boundaries",
    tags: ["buggy"],
    description: "x",
    files: ["supabase-adapter.ts"],
    expected: {
      needs_more_context_acceptable: false,
      allowed_categories: ["layer-boundaries.cross-layer-import"],
      prohibited_categories: [],
      required_findings: [
        {
          id: "req-1",
          rule_id: "ARCH-LAYERBOUNDARIES-001",
          files: ["supabase-adapter.ts"],
          line_ranges: { "supabase-adapter.ts": [2, 8] },
          severity_range: ["P1", "P1"],
          confidence_range: ["medium", "high"],
          justification: "j",
          category: "layer-boundaries.cross-layer-import",
        },
      ],
      optional_findings: [],
    },
    ...overrides,
  };
}

describe("categorySchema", () => {
  it("accepts canonical domain.subcategory format", () => {
    expect(categorySchema.safeParse("layer-boundaries.cross-layer-import").success).toBe(true);
  });

  it("rejects a bare, non-dotted category", () => {
    expect(categorySchema.safeParse("layer-boundaries").success).toBe(false);
  });
});

describe("ruleIdSchema", () => {
  it("accepts the ARCH-<DOMAIN>-NNN format", () => {
    expect(ruleIdSchema.safeParse("ARCH-LAYERBOUNDARIES-001").success).toBe(true);
  });

  it("rejects the database-benchmark's own DB- prefix", () => {
    expect(ruleIdSchema.safeParse("DB-LAYERBOUNDARIES-001").success).toBe(false);
  });
});

describe("expectedFixtureSchema", () => {
  it("accepts a well-formed buggy fixture", () => {
    expect(expectedFixtureSchema.safeParse(baseFixture()).success).toBe(true);
  });

  it("accepts a multi-file fixture", () => {
    const fixture = baseFixture({
      files: ["ingest.ts", "seed.ts"],
      tags: ["buggy", "multi_file"],
      expected: {
        needs_more_context_acceptable: false,
        allowed_categories: ["circular-dependency.mutual-module-imports"],
        prohibited_categories: [],
        required_findings: [
          {
            id: "req-1",
            rule_id: "ARCH-CIRCULARDEPENDENCY-001",
            files: ["ingest.ts", "seed.ts"],
            line_ranges: { "ingest.ts": [1, 1], "seed.ts": [1, 1] },
            severity_range: ["P1", "P1"],
            confidence_range: ["medium", "high"],
            justification: "j",
            category: "circular-dependency.mutual-module-imports",
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
      rule_id: "ARCH-LAYERBOUNDARIES-002",
      files: ["supabase-adapter.ts"],
      line_ranges: { "supabase-adapter.ts": [2, 8] },
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
            rule_id: "ARCH-AMBIGUOUS-001",
            files: ["supabase-adapter.ts"],
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
