import { describe, expect, it } from "vitest";
import { categorySchema, expectedFixtureSchema, ruleIdSchema } from "./schema";

function validManifest(overrides: Record<string, unknown> = {}): unknown {
  return {
    fixture_id: "correctness-01-off-by-one-pagination",
    domain: "correctness",
    tags: ["buggy"],
    description: "A pagination helper slices with an off-by-one end bound.",
    files: ["paginate.ts"],
    expected: {
      needs_more_context_acceptable: false,
      allowed_categories: ["correctness.off-by-one"],
      prohibited_categories: ["performance.algorithmic-complexity"],
      required_findings: [
        {
          id: "req-1",
          rule_id: "CODE-CORRECTNESS-001",
          files: ["paginate.ts"],
          line_ranges: { "paginate.ts": [6, 6] },
          severity_range: ["P1", "P1"],
          confidence_range: ["medium", "high"],
          justification: "Off-by-one, fully visible in this one function.",
        },
      ],
    },
    ...overrides,
  };
}

describe("categorySchema", () => {
  it.each(["correctness.off-by-one", "performance.algorithmic-complexity", "dead-code.unreachable"])("accepts canonical category %s", (category) => {
    expect(categorySchema.safeParse(category).success).toBe(true);
  });

  it.each(["correctness", "correctness_generic", "Correctness.OffByOne", "correctness."])("rejects non-canonical category %s", (category) => {
    expect(categorySchema.safeParse(category).success).toBe(false);
  });
});

describe("ruleIdSchema", () => {
  it.each(["CODE-CORRECTNESS-001", "CODE-PERF-002"])("accepts canonical rule_id %s", (ruleId) => {
    expect(ruleIdSchema.safeParse(ruleId).success).toBe(true);
  });

  it.each(["CODE-CORRECTNESS-1", "code-correctness-001", "SEC-CORRECTNESS-001"])("rejects non-canonical rule_id %s", (ruleId) => {
    expect(ruleIdSchema.safeParse(ruleId).success).toBe(false);
  });
});

describe("expectedFixtureSchema", () => {
  it("accepts a well-formed manifest", () => {
    expect(expectedFixtureSchema.safeParse(validManifest()).success).toBe(true);
  });

  it("accepts an empty allowed_categories for a zero-finding (safe) fixture", () => {
    const manifest = validManifest({
      tags: ["safe"],
      expected: { needs_more_context_acceptable: false, allowed_categories: [], prohibited_categories: ["correctness.off-by-one"], required_findings: [], optional_findings: [] },
    });
    expect(expectedFixtureSchema.safeParse(manifest).success).toBe(true);
  });

  it("rejects a required_findings[] entry missing rule_id", () => {
    const manifest = validManifest();
    const findings = (manifest as { expected: { required_findings: Array<Record<string, unknown>> } }).expected.required_findings;
    delete findings[0].rule_id;
    expect(expectedFixtureSchema.safeParse(manifest).success).toBe(false);
  });

  it("rejects a required_findings[].files entry not present in the fixture's own top-level files", () => {
    const manifest = validManifest();
    (manifest as { expected: { required_findings: Array<{ files: string[] }> } }).expected.required_findings[0].files = ["paginate.ts", "does-not-exist.ts"];
    expect(expectedFixtureSchema.safeParse(manifest).success).toBe(false);
  });

  it("rejects two ground-truth entries with overlapping files/line_ranges and no disjoint category set", () => {
    const manifest = validManifest({
      expected: {
        needs_more_context_acceptable: false,
        allowed_categories: ["correctness.off-by-one"],
        prohibited_categories: [],
        required_findings: [
          { id: "req-1", rule_id: "CODE-CORRECTNESS-001", files: ["paginate.ts"], line_ranges: { "paginate.ts": [6, 6] }, severity_range: ["P1", "P1"], confidence_range: ["high", "high"], justification: "x" },
        ],
        optional_findings: [
          { id: "opt-1", rule_id: "CODE-CORRECTNESS-002", files: ["paginate.ts"], line_ranges: { "paginate.ts": [6, 6] }, severity_range: ["Nit", "P2"], confidence_range: ["low", "low"], justification: "y" },
        ],
      },
    });
    expect(expectedFixtureSchema.safeParse(manifest).success).toBe(false);
  });

  it("accepts overlapping entries when alternate_categories keeps their full sets disjoint", () => {
    const manifest = validManifest({
      expected: {
        needs_more_context_acceptable: false,
        allowed_categories: ["correctness.off-by-one", "performance.generic"],
        prohibited_categories: [],
        required_findings: [
          { id: "req-1", rule_id: "CODE-CORRECTNESS-001", category: "correctness.off-by-one", files: ["paginate.ts"], line_ranges: { "paginate.ts": [6, 6] }, severity_range: ["P1", "P1"], confidence_range: ["high", "high"], justification: "x" },
        ],
        optional_findings: [
          { id: "opt-1", rule_id: "CODE-CORRECTNESS-002", category: "performance.generic", files: ["paginate.ts"], line_ranges: { "paginate.ts": [6, 6] }, severity_range: ["Nit", "P2"], confidence_range: ["low", "low"], justification: "y" },
        ],
      },
    });
    expect(expectedFixtureSchema.safeParse(manifest).success).toBe(true);
  });

  it("rejects an alternate_categories entry that collides with an overlapping sibling", () => {
    const manifest = validManifest({
      expected: {
        needs_more_context_acceptable: false,
        allowed_categories: ["correctness.off-by-one", "performance.generic"],
        prohibited_categories: [],
        required_findings: [
          { id: "req-1", rule_id: "CODE-CORRECTNESS-001", category: "correctness.off-by-one", alternate_categories: ["performance.generic"], files: ["paginate.ts"], line_ranges: { "paginate.ts": [6, 6] }, severity_range: ["P1", "P1"], confidence_range: ["high", "high"], justification: "x" },
        ],
        optional_findings: [
          { id: "opt-1", rule_id: "CODE-CORRECTNESS-002", category: "performance.generic", files: ["paginate.ts"], line_ranges: { "paginate.ts": [6, 6] }, severity_range: ["Nit", "P2"], confidence_range: ["low", "low"], justification: "y" },
        ],
      },
    });
    expect(expectedFixtureSchema.safeParse(manifest).success).toBe(false);
  });

  describe("ambiguous fixtures", () => {
    function ambiguousManifest(overrides: Record<string, unknown> = {}): unknown {
      return validManifest({
        tags: ["ambiguous"],
        expected: { needs_more_context_acceptable: true, allowed_categories: ["correctness.generic"], prohibited_categories: [], required_findings: [], optional_findings: [], ...overrides },
      });
    }

    it("accepts an ambiguous fixture with zero required and zero optional findings", () => {
      expect(expectedFixtureSchema.safeParse(ambiguousManifest()).success).toBe(true);
    });

    it("rejects an ambiguous fixture that still has a required finding", () => {
      const manifest = ambiguousManifest({
        required_findings: [{ id: "req-1", rule_id: "CODE-CORRECTNESS-001", files: ["paginate.ts"], severity_range: ["P1", "P1"], confidence_range: ["low", "low"], justification: "x" }],
      });
      expect(expectedFixtureSchema.safeParse(manifest).success).toBe(false);
    });

    it("rejects an ambiguous fixture's optional finding whose confidence_range max is not low", () => {
      const manifest = ambiguousManifest({
        optional_findings: [{ id: "opt-1", rule_id: "CODE-CORRECTNESS-001", files: ["paginate.ts"], severity_range: ["P1", "P1"], confidence_range: ["low", "medium"], justification: "x" }],
      });
      expect(expectedFixtureSchema.safeParse(manifest).success).toBe(false);
    });
  });

  describe("safe / false_positive_trap fixtures", () => {
    it("rejects a safe-tagged fixture with a non-empty optional_findings array", () => {
      const manifest = validManifest({
        tags: ["safe"],
        expected: {
          needs_more_context_acceptable: false,
          allowed_categories: [],
          prohibited_categories: ["correctness.off-by-one"],
          required_findings: [],
          optional_findings: [{ id: "opt-1", rule_id: "CODE-CORRECTNESS-001", files: ["paginate.ts"], severity_range: ["Nit", "Nit"], confidence_range: ["low", "low"], justification: "x" }],
        },
      });
      expect(expectedFixtureSchema.safeParse(manifest).success).toBe(false);
    });

    it("rejects a false_positive_trap-tagged fixture with a non-empty required_findings array", () => {
      const manifest = validManifest({ tags: ["false_positive_trap"] });
      expect(expectedFixtureSchema.safeParse(manifest).success).toBe(false);
    });
  });
});
