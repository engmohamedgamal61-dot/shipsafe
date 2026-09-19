import { describe, expect, it } from "vitest";
import { categorySchema, expectedFixtureSchema, ruleIdSchema } from "./schema";

function validManifest(overrides: Record<string, unknown> = {}): unknown {
  return {
    fixture_id: "access-control-01-idor-service-role-no-owner-check",
    domain: "access-control",
    tags: ["vulnerable"],
    spec_ref: "3.1",
    description: "A GET route uses the service-role client with no ownership check.",
    files: ["route.ts"],
    expected: {
      needs_more_context_acceptable: false,
      allowed_categories: ["access-control.idor"],
      prohibited_categories: ["injection.sql"],
      required_findings: [
        {
          id: "req-1",
          rule_id: "SEC-AUTHZ-001",
          files: ["route.ts"],
          line_ranges: { "route.ts": [8, 14] },
          severity_range: ["P0", "P0"],
          confidence_range: ["medium", "high"],
          exploit_preconditions: "None — reachable by any unauthenticated request with a guessed id.",
        },
      ],
    },
    ...overrides,
  };
}

describe("categorySchema", () => {
  it.each(["access-control.idor", "webhook.signature-verification", "llm.prompt-injection", "database.rls"])(
    "accepts canonical domain.subcategory category %s",
    (category) => {
      expect(categorySchema.safeParse(category).success).toBe(true);
    },
  );

  it.each(["access-control", "access_control.idor", "Access-Control.IDOR", "access-control.", ".idor", "webhooks"])(
    "rejects non-canonical category %s",
    (category) => {
      expect(categorySchema.safeParse(category).success).toBe(false);
    },
  );
});

describe("ruleIdSchema", () => {
  it.each(["SEC-AUTHZ-001", "SEC-WEBHOOK-002", "SEC-DB-999"])("accepts canonical rule_id %s", (ruleId) => {
    expect(ruleIdSchema.safeParse(ruleId).success).toBe(true);
  });

  it.each(["SEC-AUTHZ-1", "sec-authz-001", "SEC-AUTHZ", "SEC-001", "AUTHZ-001"])(
    "rejects non-canonical rule_id %s",
    (ruleId) => {
      expect(ruleIdSchema.safeParse(ruleId).success).toBe(false);
    },
  );
});

describe("expectedFixtureSchema", () => {
  it("accepts a well-formed manifest", () => {
    const result = expectedFixtureSchema.safeParse(validManifest());
    expect(result.success).toBe(true);
  });

  it("accepts an empty allowed_categories for a zero-finding (safe) fixture", () => {
    const manifest = validManifest({
      tags: ["safe", "false_positive_trap"],
      expected: {
        needs_more_context_acceptable: false,
        allowed_categories: [],
        prohibited_categories: ["access-control.idor"],
        required_findings: [],
        optional_findings: [],
      },
    });
    const result = expectedFixtureSchema.safeParse(manifest);
    expect(result.success).toBe(true);
  });

  it("accepts a required finding and an independent optional finding side by side", () => {
    const manifest = validManifest({
      expected: {
        needs_more_context_acceptable: false,
        allowed_categories: ["access-control.idor"],
        prohibited_categories: [],
        required_findings: [
          {
            id: "req-1",
            rule_id: "SEC-AUTHZ-001",
            category: "access-control.idor",
            files: ["route.ts"],
            severity_range: ["P0", "P0"],
            confidence_range: ["high", "high"],
            exploit_preconditions: "None.",
          },
        ],
        optional_findings: [
          {
            id: "opt-1",
            rule_id: "SEC-AUTHZ-002",
            category: "logging-privacy.verbosity",
            files: ["route.ts"],
            severity_range: ["Nit", "P2"],
            confidence_range: ["low", "medium"],
            exploit_preconditions: "A legitimate, non-mandatory secondary observation.",
          },
        ],
      },
    });
    const result = expectedFixtureSchema.safeParse(manifest);
    expect(result.success).toBe(true);
  });

  it("rejects a category not in the canonical domain.subcategory format", () => {
    const manifest = validManifest({
      expected: {
        needs_more_context_acceptable: false,
        allowed_categories: ["access-control"],
        prohibited_categories: [],
        required_findings: [],
      },
    });
    const result = expectedFixtureSchema.safeParse(manifest);
    expect(result.success).toBe(false);
  });

  it("rejects a required_findings[] entry missing rule_id", () => {
    const manifest = validManifest();
    const findings = (manifest as { expected: { required_findings: Array<Record<string, unknown>> } }).expected
      .required_findings;
    delete findings[0].rule_id;
    const result = expectedFixtureSchema.safeParse(manifest);
    expect(result.success).toBe(false);
  });

  it("rejects a rule_id not in the SEC-<DOMAIN>-NNN format", () => {
    const manifest = validManifest();
    (manifest as { expected: { required_findings: Array<{ rule_id: string }> } }).expected.required_findings[0].rule_id =
      "AUTHZ-001";
    const result = expectedFixtureSchema.safeParse(manifest);
    expect(result.success).toBe(false);
  });

  it("rejects two ground-truth entries with overlapping files/line_ranges and no distinct category to disambiguate them", () => {
    const manifest = validManifest({
      expected: {
        needs_more_context_acceptable: false,
        allowed_categories: ["access-control.idor"],
        prohibited_categories: [],
        required_findings: [
          {
            id: "req-1",
            rule_id: "SEC-AUTHZ-001",
            files: ["route.ts"],
            line_ranges: { "route.ts": [8, 14] },
            severity_range: ["P0", "P0"],
            confidence_range: ["high", "high"],
            exploit_preconditions: "None.",
          },
        ],
        optional_findings: [
          {
            id: "opt-1",
            rule_id: "SEC-AUTHZ-002",
            files: ["route.ts"],
            line_ranges: { "route.ts": [10, 12] },
            severity_range: ["Nit", "P2"],
            confidence_range: ["low", "medium"],
            exploit_preconditions: "Overlaps req-1's line range with no category on either entry.",
          },
        ],
      },
    });
    const result = expectedFixtureSchema.safeParse(manifest);
    expect(result.success).toBe(false);
  });

  describe("alternate_categories (Task: fix confirmed scorer defects, item 3)", () => {
    function overlappingManifest(
      reqOverrides: Record<string, unknown> = {},
      optOverrides: Record<string, unknown> = {},
    ): unknown {
      return validManifest({
        expected: {
          needs_more_context_acceptable: false,
          allowed_categories: ["access-control.idor", "logging-privacy.verbosity"],
          prohibited_categories: [],
          required_findings: [
            {
              id: "req-1",
              rule_id: "SEC-AUTHZ-001",
              category: "access-control.idor",
              files: ["route.ts"],
              line_ranges: { "route.ts": [8, 14] },
              severity_range: ["P0", "P0"],
              confidence_range: ["high", "high"],
              exploit_preconditions: "None.",
              ...reqOverrides,
            },
          ],
          optional_findings: [
            {
              id: "opt-1",
              rule_id: "SEC-AUTHZ-002",
              category: "logging-privacy.verbosity",
              files: ["route.ts"],
              line_ranges: { "route.ts": [10, 12] },
              severity_range: ["Nit", "P2"],
              confidence_range: ["low", "medium"],
              exploit_preconditions: "Overlaps req-1's line range.",
              ...optOverrides,
            },
          ],
        },
      });
    }

    it("accepts an entry with alternate_categories that stay disjoint from an overlapping sibling", () => {
      const manifest = overlappingManifest({ alternate_categories: ["auth.broken-authentication"] });
      const result = expectedFixtureSchema.safeParse(manifest);
      expect(result.success).toBe(true);
    });

    it("rejects an alternate_categories entry that collides with an overlapping sibling's own category", () => {
      const manifest = overlappingManifest({ alternate_categories: ["logging-privacy.verbosity"] });
      const result = expectedFixtureSchema.safeParse(manifest);
      expect(result.success).toBe(false);
    });

    it("rejects an alternate_categories entry that collides with an overlapping sibling's OWN alternate (not just its primary category)", () => {
      const manifest = overlappingManifest(
        { alternate_categories: ["injection.sql"] },
        { alternate_categories: ["injection.sql"] },
      );
      const result = expectedFixtureSchema.safeParse(manifest);
      expect(result.success).toBe(false);
    });

    it("rejects a non-canonical string in alternate_categories, same as for category itself", () => {
      const manifest = overlappingManifest({ alternate_categories: ["broken-auth"] });
      const result = expectedFixtureSchema.safeParse(manifest);
      expect(result.success).toBe(false);
    });

    it("still rejects two overlapping entries with no category/alternate_categories set on either — alternate_categories is additive, not a way to skip authoring a category at all", () => {
      const manifest = validManifest({
        expected: {
          needs_more_context_acceptable: false,
          allowed_categories: ["access-control.idor"],
          prohibited_categories: [],
          required_findings: [
            {
              id: "req-1",
              rule_id: "SEC-AUTHZ-001",
              files: ["route.ts"],
              line_ranges: { "route.ts": [8, 14] },
              severity_range: ["P0", "P0"],
              confidence_range: ["high", "high"],
              exploit_preconditions: "None.",
            },
          ],
          optional_findings: [
            {
              id: "opt-1",
              rule_id: "SEC-AUTHZ-002",
              alternate_categories: ["logging-privacy.verbosity"],
              files: ["route.ts"],
              line_ranges: { "route.ts": [10, 12] },
              severity_range: ["Nit", "P2"],
              confidence_range: ["low", "medium"],
              exploit_preconditions: "req-1 still has no category/alternate at all.",
            },
          ],
        },
      });
      const result = expectedFixtureSchema.safeParse(manifest);
      expect(result.success).toBe(false);
    });
  });

  it("rejects a severity_range with an inverted order (P0 stricter than the stated max)", () => {
    const manifest = validManifest();
    (manifest as { expected: { required_findings: Array<{ severity_range: string[] }> } }).expected
      .required_findings[0].severity_range = ["P0", "Nit"];
    const result = expectedFixtureSchema.safeParse(manifest);
    expect(result.success).toBe(false);
  });

  it("rejects a confidence_range with an inverted order", () => {
    const manifest = validManifest();
    (manifest as { expected: { required_findings: Array<{ confidence_range: string[] }> } }).expected
      .required_findings[0].confidence_range = ["high", "low"];
    const result = expectedFixtureSchema.safeParse(manifest);
    expect(result.success).toBe(false);
  });

  it("rejects a line range where start > end", () => {
    const manifest = validManifest();
    (
      manifest as {
        expected: { required_findings: Array<{ line_ranges: Record<string, number[]> }> };
      }
    ).expected.required_findings[0].line_ranges = { "route.ts": [20, 5] };
    const result = expectedFixtureSchema.safeParse(manifest);
    expect(result.success).toBe(false);
  });

  it("rejects a required_findings[].files entry not present in the fixture's own top-level files (hallucinated reference)", () => {
    const manifest = validManifest();
    (manifest as { files: string[] }).files = ["route.ts"];
    (manifest as { expected: { required_findings: Array<{ files: string[] }> } }).expected.required_findings[0].files =
      ["route.ts", "does-not-exist.ts"];
    const result = expectedFixtureSchema.safeParse(manifest);
    expect(result.success).toBe(false);
  });

  it("rejects a required_findings[].line_ranges key not present in that finding's own files", () => {
    const manifest = validManifest();
    (
      manifest as {
        expected: {
          required_findings: Array<{
            id: string;
            rule_id: string;
            files: string[];
            severity_range: string[];
            confidence_range: string[];
            exploit_preconditions: string;
            line_ranges: Record<string, number[]>;
          }>;
        };
      }
    ).expected.required_findings[0] = {
      id: "req-1",
      rule_id: "SEC-AUTHZ-001",
      files: ["route.ts"],
      severity_range: ["P0", "P0"],
      confidence_range: ["high", "high"],
      exploit_preconditions: "None.",
      line_ranges: { "other-file.ts": [1, 2] },
    };
    const result = expectedFixtureSchema.safeParse(manifest);
    expect(result.success).toBe(false);
  });

  it("rejects a manifest missing required top-level fields", () => {
    const { fixture_id: _fixtureId, ...withoutFixtureId } = validManifest() as Record<string, unknown>;
    const result = expectedFixtureSchema.safeParse(withoutFixtureId);
    expect(result.success).toBe(false);
  });

  it("rejects an unknown tag value", () => {
    const manifest = validManifest({ tags: ["not-a-real-tag"] });
    const result = expectedFixtureSchema.safeParse(manifest);
    expect(result.success).toBe(false);
  });

  it("rejects an empty tags array", () => {
    const manifest = validManifest({ tags: [] });
    const result = expectedFixtureSchema.safeParse(manifest);
    expect(result.success).toBe(false);
  });

  it("defaults prohibited_categories, required_findings, and optional_findings when omitted", () => {
    const manifest = validManifest({
      expected: {
        needs_more_context_acceptable: false,
        allowed_categories: [],
      },
    });
    const result = expectedFixtureSchema.safeParse(manifest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.expected.prohibited_categories).toEqual([]);
      expect(result.data.expected.required_findings).toEqual([]);
      expect(result.data.expected.optional_findings).toEqual([]);
    }
  });

  it("rejects a category listed in both allowed_categories and prohibited_categories", () => {
    const manifest = validManifest({
      expected: {
        needs_more_context_acceptable: false,
        allowed_categories: ["access-control.idor"],
        prohibited_categories: ["access-control.idor"],
        required_findings: [],
      },
    });
    const result = expectedFixtureSchema.safeParse(manifest);
    expect(result.success).toBe(false);
  });

  it("rejects a duplicate id shared between a required and an optional finding", () => {
    const manifest = validManifest({
      expected: {
        needs_more_context_acceptable: false,
        allowed_categories: ["access-control.idor"],
        prohibited_categories: [],
        required_findings: [
          {
            id: "shared-id",
            rule_id: "SEC-AUTHZ-001",
            files: ["route.ts"],
            severity_range: ["P0", "P0"],
            confidence_range: ["high", "high"],
            exploit_preconditions: "None.",
          },
        ],
        optional_findings: [
          {
            id: "shared-id",
            rule_id: "SEC-AUTHZ-002",
            files: ["route.ts"],
            severity_range: ["Nit", "P2"],
            confidence_range: ["low", "low"],
            exploit_preconditions: "None.",
          },
        ],
      },
    });
    const result = expectedFixtureSchema.safeParse(manifest);
    expect(result.success).toBe(false);
  });

  it("rejects a duplicate rule_id shared between a required and an optional finding (even with distinct ids)", () => {
    const manifest = validManifest({
      expected: {
        needs_more_context_acceptable: false,
        allowed_categories: ["access-control.idor"],
        prohibited_categories: [],
        required_findings: [
          {
            id: "req-1",
            rule_id: "SEC-AUTHZ-001",
            files: ["route.ts"],
            severity_range: ["P0", "P0"],
            confidence_range: ["high", "high"],
            exploit_preconditions: "None.",
          },
        ],
        optional_findings: [
          {
            id: "opt-1",
            rule_id: "SEC-AUTHZ-001",
            files: ["route.ts"],
            severity_range: ["Nit", "P2"],
            confidence_range: ["low", "low"],
            exploit_preconditions: "None.",
          },
        ],
      },
    });
    const result = expectedFixtureSchema.safeParse(manifest);
    expect(result.success).toBe(false);
  });

  describe("ambiguous fixtures", () => {
    function ambiguousManifest(overrides: Record<string, unknown> = {}): unknown {
      return validManifest({
        tags: ["ambiguous"],
        expected: {
          needs_more_context_acceptable: true,
          allowed_categories: ["access-control.idor"],
          prohibited_categories: [],
          required_findings: [],
          optional_findings: [],
          ...overrides,
        },
      });
    }

    it("accepts an ambiguous fixture with zero required and zero optional findings", () => {
      const result = expectedFixtureSchema.safeParse(ambiguousManifest());
      expect(result.success).toBe(true);
    });

    it("accepts an ambiguous fixture's optional finding whose confidence_range max is low", () => {
      const manifest = ambiguousManifest({
        optional_findings: [
          {
            id: "opt-1",
            rule_id: "SEC-AUTHZ-001",
            files: ["route.ts"],
            severity_range: ["P1", "P1"],
            confidence_range: ["low", "low"],
            exploit_preconditions: "Unconfirmed reachability.",
          },
        ],
      });
      const result = expectedFixtureSchema.safeParse(manifest);
      expect(result.success).toBe(true);
    });

    it("rejects an ambiguous fixture that still has a required finding (the original fixture-9 bug)", () => {
      const manifest = ambiguousManifest({
        required_findings: [
          {
            id: "req-1",
            rule_id: "SEC-AUTHZ-001",
            files: ["route.ts"],
            severity_range: ["P1", "P1"],
            confidence_range: ["low", "low"],
            exploit_preconditions: "None.",
          },
        ],
      });
      const result = expectedFixtureSchema.safeParse(manifest);
      expect(result.success).toBe(false);
    });

    it("rejects an ambiguous fixture's optional finding whose confidence_range max is medium or high", () => {
      const manifest = ambiguousManifest({
        optional_findings: [
          {
            id: "opt-1",
            rule_id: "SEC-AUTHZ-001",
            files: ["route.ts"],
            severity_range: ["P1", "P1"],
            confidence_range: ["low", "medium"],
            exploit_preconditions: "Unconfirmed reachability.",
          },
        ],
      });
      const result = expectedFixtureSchema.safeParse(manifest);
      expect(result.success).toBe(false);
    });
  });

  describe("safe / false_positive_trap fixtures", () => {
    it("rejects a safe-tagged fixture with a non-empty optional_findings array", () => {
      const manifest = validManifest({
        tags: ["safe"],
        expected: {
          needs_more_context_acceptable: false,
          allowed_categories: [],
          prohibited_categories: ["access-control.idor"],
          required_findings: [],
          optional_findings: [
            {
              id: "opt-1",
              rule_id: "SEC-AUTHZ-001",
              files: ["route.ts"],
              severity_range: ["Nit", "Nit"],
              confidence_range: ["low", "low"],
              exploit_preconditions: "None.",
            },
          ],
        },
      });
      const result = expectedFixtureSchema.safeParse(manifest);
      expect(result.success).toBe(false);
    });

    it("rejects a false_positive_trap-tagged fixture with a non-empty required_findings array", () => {
      const manifest = validManifest({ tags: ["false_positive_trap"] });
      const result = expectedFixtureSchema.safeParse(manifest);
      expect(result.success).toBe(false);
    });
  });
});
