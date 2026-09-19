import { z } from "zod";

/**
 * Zod validation for the fixture manifest shape defined in
 * `docs/agents/security-benchmark-plan.md` §3 ("Expected-Answer
 * Schema"). The plan's own manifest example is illustrative JSON; this
 * is the actual, enforced implementation of it — using this codebase's
 * established validation library (Zod, used at every other external
 * boundary — see `src/domain/schemas.ts`) rather than introducing a
 * separate JSON Schema toolchain for one thing. Deliberately outside
 * `src/server/review-engine/` — this validates benchmark fixtures, it
 * is never imported by the production review engine.
 */

export const severitySchema = z.enum(["P0", "P1", "P2", "Nit"]);
export type Severity = z.infer<typeof severitySchema>;

export const confidenceSchema = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof confidenceSchema>;

/**
 * The spec's §4.1 three-state evidence model, mirrored here for the
 * PRODUCED side (`scorer.ts`'s `producedFindingSchema`) — see that
 * schema's own `evidenceState` field comment for the full scoring
 * contract this enables. `"needs_more_context"` is deliberately part of
 * this enum even though the spec (§4.1) says it is "never a finding's
 * own `evidence_state` value" in a fully spec-compliant reviewer — this
 * benchmark still needs to represent (and correctly, leniently score) a
 * produced finding that carries it anyway, since a real reviewer under
 * test may emit one before it fully separates `needs_more_context` into
 * the spec's own distinct §4.4 status object. See `scorer.ts`'s
 * `"insufficient_evidence"` classification for how that case is scored.
 */
export const evidenceStateSchema = z.enum(["proven", "strongly_supported", "needs_more_context"]);
export type EvidenceState = z.infer<typeof evidenceStateSchema>;

/** See the plan §2 — a fixture's archetype tag(s), independent of its domain (folder). */
export const tagSchema = z.enum([
  "vulnerable",
  "safe",
  "ambiguous",
  "false_positive_trap",
  "multi_file",
  "concurrency",
]);
export type FixtureTag = z.infer<typeof tagSchema>;

// Exported for scorer.ts, which needs the same ordering to measure how far
// outside a range a produced finding's severity/confidence falls.
export const SEVERITY_RANK: Record<Severity, number> = { Nit: 0, P2: 1, P1: 2, P0: 3 };
export const CONFIDENCE_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

/** A [min, max] pair over the severity ordering Nit < P2 < P1 < P0 — min must not be a *stricter* severity than max. */
const severityRangeSchema = z
  .tuple([severitySchema, severitySchema])
  .refine(([min, max]) => SEVERITY_RANK[min] <= SEVERITY_RANK[max], {
    message: "severity_range[0] must not be a stricter severity than severity_range[1]",
  });

/** A [min, max] pair over low < medium < high. */
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
 * kebab-case (e.g. `access-control.idor`, `webhook.idempotency`,
 * `llm.prompt-injection`). Enforced on every category a FIXTURE
 * manifest declares (`allowed_categories`, `prohibited_categories`,
 * `required_findings[]`/`optional_findings[].category`) — this is the
 * ground-truth side of the contract. Deliberately NOT enforced on a
 * *produced* finding's category in `scorer.ts` — today's production
 * reviewer emits plain, unmigrated category strings (e.g. `"access-
 * control"`, not `"access-control.idor"`), and requiring the canonical
 * format there would make it impossible to benchmark unmodified
 * production output at all, contradicting the "no production changes"
 * constraint this whole exercise runs under.
 */
export const categorySchema = z
  .string()
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*\.[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'category must follow the canonical "domain.subcategory" format (lowercase kebab-case on each side, e.g. "access-control.idor") — no ad hoc strings',
  );

/**
 * `SEC-<DOMAIN>-NNN` — e.g. `SEC-AUTHZ-001`, `SEC-WEBHOOK-002`. A stable
 * benchmark identity for a root cause, independent of the fixture's
 * `id`/`category`/location — see `groundTruthFindingSchema.rule_id`'s
 * own doc comment for what this is (and isn't) for.
 */
export const ruleIdSchema = z
  .string()
  .regex(/^SEC-[A-Z]+-\d{3}$/, 'rule_id must follow the format "SEC-<DOMAIN>-NNN" (e.g. "SEC-AUTHZ-001")');

/**
 * One ground-truth finding. Used for BOTH `required_findings[]` and
 * `optional_findings[]` — the shape is identical; only which array it
 * lives in changes how the scorer treats it (see `scorer.ts`):
 * unmatched `required_findings[]` entries cost points, unmatched
 * `optional_findings[]` entries never do. This is the mechanism that
 * fixes the original ambiguity where a fixture's one genuine-but-
 * conditional secondary observation had no home other than
 * `required_findings[]` (forcing an artificially widened
 * `finding_count.max` as a workaround) — see §3.1 of the plan.
 */
export const groundTruthFindingSchema = z.object({
  id: z.string().min(1),
  /**
   * `SEC-<DOMAIN>-NNN` — the STABLE benchmark identity for this root
   * cause. Required on every ground-truth entry (unlike `category`,
   * which stays optional). Two things this is NOT:
   * - It is not derived from, or meaningful via, its numeric portion
   *   alone (`NNN` is just a per-domain sequence number, not a
   *   severity/priority/ordering signal — `SEC-AUTHZ-002` is not
   *   "worse than" `SEC-AUTHZ-001`).
   * - It is not a CWE/OWASP replacement — `standards`-style mappings
   *   (CWE numbers, OWASP Top 10 IDs) belong to the spec's own taxonomy
   *   (`docs/agents/security-reviewer-v2.md` §1); this is a benchmark/
   *   fixture-authoring identifier for "this specific root cause in
   *   this specific fixture," used by the scorer as the primary,
   *   unambiguous match key (see `scorer.ts` §4.1) — a produced finding
   *   citing the exact right `rule_id` is trusted over one that merely
   *   happens to cite the same file/line.
   */
  rule_id: ruleIdSchema,
  files: z.array(z.string().min(1)).min(1),
  // Keyed by a path that must also appear in this same finding's `files` —
  // checked below, not expressible in the per-field schema alone.
  line_ranges: z.record(z.string(), lineRangeSchema.nullable()).optional(),
  severity_range: severityRangeSchema,
  confidence_range: confidenceRangeSchema,
  exploit_preconditions: z.string().min(1),
  /**
   * A specific sub-check name in the canonical `domain.subcategory`
   * format (§3.2 of the plan, `categorySchema` above — e.g.
   * `webhook.idempotency`), not the fixture's whole domain. Optional —
   * the `rule_id` above is now the
   * primary disambiguator the scorer prefers (§4.1's matching order) —
   * but still REQUIRED whenever a fixture has more than one
   * ground-truth entry (required and/or optional together) whose
   * `files`/`line_ranges` overlap, as the fallback disambiguator for a
   * produced finding that doesn't supply a `rule_id` (today's
   * production reviewer doesn't yet emit one — see `scorer.ts`).
   */
  category: categorySchema.optional(),
  /**
   * Zero or more ADDITIONAL canonical categories a produced finding may
   * claim to still match this entry via the disambiguation gate
   * (`scorer.ts`'s `matchesByLocation`), alongside `category` itself.
   *
   * Added to fix a confirmed scorer defect (not a schema loosening): the
   * plan's §3.6 rule — "a `.generic` compatibility category can never
   * wrongly disambiguate two overlapping entries" — correctly prevents a
   * vague label from resolving an overlap, but it left no way for a
   * fixture author to say "this SPECIFIC other label is ALSO a
   * legitimate, unambiguous name for this same root cause" (e.g.
   * `webhooks-01`'s missing-signature-verification finding is validly
   * describable as `webhook.signature-verification` OR the more general,
   * but still specific and unambiguous, `auth.broken-authentication` —
   * neither is a guess, both genuinely name the same failure). Every
   * entry here is:
   * - **Explicit, hand-authored per entry** — never inferred from a
   *   compatibility-table lookup or any other heuristic. Adding one is a
   *   fixture-authoring decision, made only after confirming it cannot
   *   also satisfy a SIBLING overlapping entry (enforced below).
   * - **Still required to be canonical** (`categorySchema`) — this is
   *   not a place for a raw/legacy string; `category-compat.ts` still
   *   does that normalization before either `category` or any of these
   *   alternates is compared against.
   * - **Cross-checked for overlap safety**: the schema-level check below
   *   (this file's own `superRefine`) still requires two overlapping
   *   entries' FULL category sets (`category` + `alternate_categories`)
   *   to be completely disjoint — adding an alternate can never silently
   *   reintroduce the exact ambiguity §3.6 exists to prevent.
   */
  alternate_categories: z.array(categorySchema).optional(),
  /**
   * Whether this entry may be matched by a produced finding that cites
   * NO file at all (`file: null`) — i.e. a repository-wide/
   * configuration finding, not tied to one specific location. Defaults
   * `false`. This is a real, currently-active production behavior, not
   * a hypothetical: the reviewer's own system prompt
   * (`providers/prompt.ts`) instructs it to "leave filePath and line
   * fields null" whenever it can't point to a specific line — so the
   * benchmark must be able to score that output rather than treating
   * every null-file finding as unscoreable. Must be explicit
   * (opt-in per entry) rather than inferred, so a fixture never
   * *accidentally* accepts a location-less finding as a match for a
   * root cause that's actually supposed to be pinned to a specific
   * file/line — see `scorer.ts`'s `matchesByLocation`.
   */
  repository_scope: z.boolean().default(false),
  // Documentation only for multi-file fixtures — the scorer's generic
  // duplicate-detection (§4.2) already enforces "one finding per root
  // cause" without reading this flag.
  must_reference_root_cause_once: z.boolean().optional(),
});
export type GroundTruthFinding = z.infer<typeof groundTruthFindingSchema>;

export const expectedFixtureSchema = z
  .object({
    fixture_id: z.string().min(1),
    domain: z.string().min(1),
    tags: z.array(tagSchema).min(1),
    spec_ref: z.string().min(1),
    description: z.string().min(1),
    /**
     * Every source file this fixture's ground truth refers to, relative
     * to this fixture's `fixture/` directory. This is the fixture's own
     * declared ground truth — `validateFixture()` in `load-fixtures.ts`
     * additionally checks every one of these paths actually exists on
     * disk; that disk check can't live in this schema (Zod validates
     * shape, not the filesystem).
     */
    files: z.array(z.string().min(1)).min(1),
    expected: z.object({
      /**
       * Whether `needs_more_context` (or zero findings) is a fully
       * correct answer for this fixture — true for every
       * `ambiguous`-tagged fixture, and only those. When true,
       * `required_findings` MUST be empty (see the cross-field check
       * below): an ambiguous fixture's conditional observation is, by
       * definition, not something the reviewer is required to assert —
       * encoding it as required would contradict `needs_more_context`
       * being correct at the same time.
       */
      needs_more_context_acceptable: z.boolean(),
      /**
       * Categories a produced finding is even allowed to claim for this
       * fixture. Necessary but NOT sufficient for correctness: a finding
       * in an allowed category that doesn't correspond to any
       * `required_findings[]`/`optional_findings[]` entry is still an
       * "unsupported/unverified extra" (see `scorer.ts`), not an
       * automatic pass. Empty for a fixture whose only correct answer is
       * zero findings (`safe`/`false_positive_trap`).
       */
      allowed_categories: z.array(categorySchema),
      /**
       * Categories that are explicitly, definitely wrong for this
       * fixture — any produced finding in one of these is a prohibited
       * finding regardless of anything else about it. This is a
       * documentation/authoring aid on top of the stricter rule the
       * scorer actually enforces (any category NOT in
       * `allowed_categories` is prohibited by default) — listing the
       * specific traps a fixture is guarding against here makes that
       * intent explicit for a human reading the manifest.
       */
      prohibited_categories: z.array(categorySchema).default([]),
      /** A vulnerability the reviewer is expected to detect. Missing one costs points; see `scorer.ts`. */
      required_findings: z.array(groundTruthFindingSchema).default([]),
      /**
       * A legitimate secondary observation that's allowed but must NOT
       * be required for full credit — matching one is never penalized,
       * and never scored as a false positive, but a fixture still
       * passes with zero of them produced.
       */
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
      ...fixture.expected.required_findings.map((finding, index) => ({
        finding,
        arrayPath: "required_findings" as const,
        index,
      })),
      ...fixture.expected.optional_findings.map((finding, index) => ({
        finding,
        arrayPath: "optional_findings" as const,
        index,
      })),
    ];

    for (const { finding, arrayPath, index } of allGroundTruth) {
      const path = ["expected", arrayPath, index] as const;

      if (seenIds.has(finding.id)) {
        ctx.addIssue({
          code: "custom",
          path: [...path, "id"],
          message: `duplicate ground-truth finding id "${finding.id}" — every id across required_findings and optional_findings must be unique within a fixture`,
        });
      }
      seenIds.add(finding.id);

      if (seenRuleIds.has(finding.rule_id)) {
        ctx.addIssue({
          code: "custom",
          path: [...path, "rule_id"],
          message: `duplicate rule_id "${finding.rule_id}" — rule_id must be unique within a fixture (across required_findings and optional_findings together)`,
        });
      }
      seenRuleIds.add(finding.rule_id);

      for (const file of finding.files) {
        if (!knownFiles.has(file)) {
          ctx.addIssue({
            code: "custom",
            path: [...path, "files"],
            message: `references file "${file}" which is not in the fixture's top-level "files" list — a finding can't reference a file the fixture never declared`,
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
          message: `category "${category}" appears in both allowed_categories and prohibited_categories — a category can't be both`,
        });
      }
    }

    // Two ground-truth entries (required and/or optional) whose
    // files/line_ranges overlap can't be told apart by the scorer's
    // file+line matching alone — it would attribute a produced finding
    // to whichever entry happens to be checked first (or, worse, treat
    // a genuinely distinct second finding as a duplicate of the first).
    // A FULLY DISJOINT category set (`category` + `alternate_categories`)
    // on each overlapping entry is required so the scorer can
    // disambiguate by category too — checking the full set, not just
    // `category` alone, is what lets `alternate_categories` add a second
    // legitimate name for a root cause without reintroducing the exact
    // ambiguity this check exists to prevent (see that field's own doc
    // comment above).
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
            message: `ground-truth findings "${a.id}" and "${b.id}" have overlapping files/line_ranges with no fully disjoint "category"/"alternate_categories" set on both — the scorer can't disambiguate which entry a produced finding at that location matches; give each a distinct, non-overlapping category set`,
          });
        }
      }
    }

    // Do not encode an ambiguous/conditional observation as a required
    // finding — that's the exact ambiguity this schema exists to close.
    if (isAmbiguous && fixture.expected.required_findings.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["expected", "required_findings"],
        message:
          "an ambiguous fixture (needs_more_context_acceptable: true) must have zero required_findings — a conditional observation belongs in optional_findings, never required_findings, since needs_more_context/no-finding must also be a fully correct answer",
      });
    }

    // An ambiguous fixture's conditional observation is only correct at
    // low confidence — a confident assertion contradicts the fixture's
    // own premise that reachability/impact can't be confirmed from what
    // it includes.
    if (isAmbiguous) {
      for (const finding of fixture.expected.optional_findings) {
        if (finding.confidence_range[1] !== "low") {
          ctx.addIssue({
            code: "custom",
            path: ["expected", "optional_findings"],
            message: `ambiguous fixture's optional_findings[].confidence_range max must be "low" (got "${finding.confidence_range[1]}" for finding "${finding.id}") — a confident finding on an ambiguous fixture is never correct`,
          });
        }
      }
    }

    // Safe / false_positive_trap fixtures: the expected result is zero
    // findings, full stop — not "zero required, but some optional are
    // fine too."
    if (isSafe && (fixture.expected.required_findings.length > 0 || fixture.expected.optional_findings.length > 0)) {
      ctx.addIssue({
        code: "custom",
        path: ["expected"],
        message:
          'a "safe"/"false_positive_trap" fixture must have zero required_findings and zero optional_findings — its expected result is zero findings',
      });
    }
  });

export type ExpectedFixture = z.infer<typeof expectedFixtureSchema>;
