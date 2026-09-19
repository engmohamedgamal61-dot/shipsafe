import { z } from "zod";

/**
 * Zod validation for the Architecture Reviewer benchmark's fixture
 * manifest shape — the ground-truth contract for
 * `tests/architecture-benchmarks/`.
 *
 * Deliberately parallel to, but INDEPENDENT of,
 * `src/server/code-benchmarks/schema.ts`, `security-benchmarks/schema.ts`,
 * and `database-benchmarks/schema.ts`: same architecture
 * (required/optional/prohibited findings, alternate categories,
 * severity/confidence ranges, ambiguous-fixture handling) because that
 * architecture is domain-agnostic, but a completely separate module —
 * see `tests/architecture-benchmarks/README.md` for why the four
 * benchmarks are kept apart rather than sharing one scorer. Never
 * imported by `src/server/review-engine/` or by any other benchmark.
 */

export const severitySchema = z.enum(["P0", "P1", "P2", "Nit"]);
export type Severity = z.infer<typeof severitySchema>;

export const confidenceSchema = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof confidenceSchema>;

/** A fixture's archetype tag(s), independent of its domain (folder). */
export const tagSchema = z.enum(["buggy", "safe", "ambiguous", "false_positive_trap", "multi_file"]);
export type FixtureTag = z.infer<typeof tagSchema>;

export const SEVERITY_RANK: Record<Severity, number> = { Nit: 0, P2: 1, P1: 2, P0: 3 };
export const CONFIDENCE_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

const severityRangeSchema = z
  .tuple([severitySchema, severitySchema])
  .refine(([min, max]) => SEVERITY_RANK[min] <= SEVERITY_RANK[max], {
    message: "severity_range[0] must not be a stricter severity than severity_range[1]",
  });

const confidenceRangeSchema = z
  .tuple([confidenceSchema, confidenceSchema])
  .refine(([min, max]) => CONFIDENCE_RANK[min] <= CONFIDENCE_RANK[max], {
    message: "confidence_range[0] must not exceed confidence_range[1]",
  });

const lineRangeSchema = z
  .tuple([z.number().int().positive(), z.number().int().positive()])
  .refine(([start, end]) => start <= end, { message: "line range start must be <= end" });

/**
 * Canonical category format: `domain.subcategory`, both lowercase
 * kebab-case (e.g. `layer-boundaries.cross-layer-import`,
 * `circular-dependency.mutual-module-imports`). Enforced on the
 * GROUND-TRUTH side only — never on a produced finding's own category,
 * which today's production Architecture Reviewer emits as free-form
 * text (mirrors the other three benchmarks' identically-purposed
 * `categorySchema`, for the identical reason: production must be
 * benchmarkable unmodified).
 */
export const categorySchema = z
  .string()
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*\.[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'category must follow the canonical "domain.subcategory" format (e.g. "layer-boundaries.cross-layer-import")',
  );

/** `ARCH-<DOMAIN>-NNN` — a stable benchmark identity for a root cause, independent of category/location. Not currently used as a primary match key (production emits no rule id), kept for parity with the other benchmarks' schemas and for a future reviewer that does emit one. */
export const ruleIdSchema = z
  .string()
  .regex(/^ARCH-[A-Z]+-\d{3}$/, 'rule_id must follow the format "ARCH-<DOMAIN>-NNN" (e.g. "ARCH-LAYERBOUNDARIES-001")');

export const groundTruthFindingSchema = z.object({
  id: z.string().min(1),
  rule_id: ruleIdSchema,
  files: z.array(z.string().min(1)).min(1),
  line_ranges: z.record(z.string(), lineRangeSchema.nullable()).optional(),
  severity_range: severityRangeSchema,
  confidence_range: confidenceRangeSchema,
  /** Human-readable ground truth for WHY this is a real, confirmable architectural defect (or, on an optional/ambiguous entry, what specifically remains unconfirmed). Not scored directly; used when hand-auditing a run. */
  justification: z.string().min(1),
  /** A specific sub-check name in canonical `domain.subcategory` format. Optional — required only when a fixture has more than one ground-truth entry whose files/line_ranges overlap (schema-enforced below). */
  category: categorySchema.optional(),
  /** Zero or more ADDITIONAL canonical categories that also validly name this same root cause. */
  alternate_categories: z.array(categorySchema).optional(),
  /** Whether this entry may be matched by a produced finding that cites no file at all. Defaults false. */
  repository_scope: z.boolean().default(false),
  must_reference_root_cause_once: z.boolean().optional(),
});
export type GroundTruthFinding = z.infer<typeof groundTruthFindingSchema>;

export const expectedFixtureSchema = z
  .object({
    fixture_id: z.string().min(1),
    domain: z.string().min(1),
    tags: z.array(tagSchema).min(1),
    description: z.string().min(1),
    files: z.array(z.string().min(1)).min(1),
    expected: z.object({
      needs_more_context_acceptable: z.boolean(),
      allowed_categories: z.array(categorySchema),
      prohibited_categories: z.array(categorySchema).default([]),
      required_findings: z.array(groundTruthFindingSchema).default([]),
      optional_findings: z.array(groundTruthFindingSchema).default([]),
    }),
    explanation: z.string().optional(),
  })
  .superRefine((fixture, ctx) => {
    const knownFiles = new Set(fixture.files);
    const isAmbiguous = fixture.expected.needs_more_context_acceptable;
    const isSafe = fixture.tags.includes("safe") || fixture.tags.includes("false_positive_trap");
    const allowed = new Set(fixture.expected.allowed_categories);
    const prohibited = new Set(fixture.expected.prohibited_categories);

    const seenIds = new Set<string>();
    const seenRuleIds = new Set<string>();
    const allGroundTruth: Array<{ finding: GroundTruthFinding; arrayPath: "required_findings" | "optional_findings"; index: number }> = [
      ...fixture.expected.required_findings.map((finding, index) => ({ finding, arrayPath: "required_findings" as const, index })),
      ...fixture.expected.optional_findings.map((finding, index) => ({ finding, arrayPath: "optional_findings" as const, index })),
    ];

    for (const { finding, arrayPath, index } of allGroundTruth) {
      const path = ["expected", arrayPath, index] as const;

      if (seenIds.has(finding.id)) {
        ctx.addIssue({ code: "custom", path: [...path, "id"], message: `duplicate ground-truth finding id "${finding.id}"` });
      }
      seenIds.add(finding.id);

      if (seenRuleIds.has(finding.rule_id)) {
        ctx.addIssue({ code: "custom", path: [...path, "rule_id"], message: `duplicate rule_id "${finding.rule_id}"` });
      }
      seenRuleIds.add(finding.rule_id);

      for (const file of finding.files) {
        if (!knownFiles.has(file)) {
          ctx.addIssue({
            code: "custom",
            path: [...path, "files"],
            message: `references file "${file}" which is not in the fixture's top-level "files" list`,
          });
        }
      }

      if (finding.line_ranges) {
        const findingFiles = new Set(finding.files);
        for (const file of Object.keys(finding.line_ranges)) {
          if (!findingFiles.has(file)) {
            ctx.addIssue({
              code: "custom",
              path: [...path, "line_ranges"],
              message: `line_ranges key "${file}" is not in this same finding's own "files" list`,
            });
          }
        }
      }
    }

    for (const category of allowed) {
      if (prohibited.has(category)) {
        ctx.addIssue({
          code: "custom",
          path: ["expected", "prohibited_categories"],
          message: `category "${category}" appears in both allowed_categories and prohibited_categories`,
        });
      }
    }

    const categorySet = (finding: GroundTruthFinding): string[] =>
      [finding.category, ...(finding.alternate_categories ?? [])].filter((c): c is string => c !== undefined);

    for (let i = 0; i < allGroundTruth.length; i++) {
      for (let j = i + 1; j < allGroundTruth.length; j++) {
        const a = allGroundTruth[i].finding;
        const b = allGroundTruth[j].finding;
        const aCategories = categorySet(a);
        const bCategories = categorySet(b);
        const disjoint = aCategories.length > 0 && bCategories.length > 0 && !aCategories.some((c) => bCategories.includes(c));
        if (disjoint) continue;

        const sharedFiles = a.files.filter((file) => b.files.includes(file));
        if (sharedFiles.length === 0) continue;

        const overlaps = sharedFiles.some((file) => {
          const rangeA = a.line_ranges?.[file];
          const rangeB = b.line_ranges?.[file];
          if (rangeA === undefined || rangeA === null || rangeB === undefined || rangeB === null) return true;
          return rangeA[0] <= rangeB[1] && rangeB[0] <= rangeA[1];
        });

        if (overlaps) {
          ctx.addIssue({
            code: "custom",
            path: ["expected"],
            message: `ground-truth findings "${a.id}" and "${b.id}" have overlapping files/line_ranges with no fully disjoint category set on both — give each a distinct, non-overlapping category set`,
          });
        }
      }
    }

    if (isAmbiguous && fixture.expected.required_findings.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["expected", "required_findings"],
        message: "an ambiguous fixture (needs_more_context_acceptable: true) must have zero required_findings",
      });
    }

    if (isAmbiguous) {
      for (const finding of fixture.expected.optional_findings) {
        if (finding.confidence_range[1] !== "low") {
          ctx.addIssue({
            code: "custom",
            path: ["expected", "optional_findings"],
            message: `ambiguous fixture's optional_findings[].confidence_range max must be "low" (got "${finding.confidence_range[1]}" for finding "${finding.id}")`,
          });
        }
      }
    }

    if (isSafe && (fixture.expected.required_findings.length > 0 || fixture.expected.optional_findings.length > 0)) {
      ctx.addIssue({
        code: "custom",
        path: ["expected"],
        message: 'a "safe"/"false_positive_trap" fixture must have zero required_findings and zero optional_findings',
      });
    }
  });

export type ExpectedFixture = z.infer<typeof expectedFixtureSchema>;
