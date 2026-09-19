import { z } from "zod";

/**
 * Zod validation for the Release Judge benchmark's fixture manifest
 * shape — the ground-truth contract for
 * `tests/release-judge-benchmarks/`.
 *
 * Deliberately a SMALLER, differently-shaped schema than the five
 * specialist reviewers' benchmarks (`code-benchmarks/schema.ts`,
 * `security-benchmarks/schema.ts`, `database-benchmarks/schema.ts`,
 * `architecture-benchmarks/schema.ts`, `test-reviewer-benchmarks/schema.ts`):
 * those benchmarks grade an LLM's own freeform list of many findings
 * against many possible ground-truth findings, which needs the full
 * required/optional/prohibited-category/location-matching machinery.
 * The Release Judge's production output (`judgeOutputSchema` in
 * `@/domain/schemas`) is just ONE categorical `verdict` plus ONE prose
 * `summary` — there is nothing to location-match. Reusing the five
 * reviewers' matching architecture here would be complexity with no
 * corresponding problem to solve, so this schema is purpose-built:
 * a fixture is a set of SIMULATED specialist `ReviewerRun`s (not raw
 * code/diff — the judge never sees a diff) plus ground truth about the
 * expected verdict and the qualitative properties (blocking findings,
 * duplicate root causes, low-confidence findings, required-reviewer
 * coverage, and hallucination-probe terms) a well-behaved judge must
 * respect when reasoning over those runs. Never imported by
 * `src/server/review-engine/` or by any of the five reviewer benchmarks.
 */

export const severitySchema = z.enum(["P0", "P1", "P2", "NIT"]);
export type FixtureSeverity = z.infer<typeof severitySchema>;

export const verdictSchema = z.enum(["APPROVE", "APPROVE_WITH_MINOR_FIXES", "DO_NOT_APPROVE"]);
export type FixtureVerdict = z.infer<typeof verdictSchema>;

export const specialistReviewerSchema = z.enum(["code", "security", "architecture", "database", "test"]);
export type SpecialistReviewer = z.infer<typeof specialistReviewerSchema>;

/** A fixture's archetype tag(s) — purely descriptive/organizational, not scored directly. */
export const tagSchema = z.enum([
  "clean",
  "minor-only",
  "confirmed-blocker",
  "aggregate-risk",
  "conflicting-signals",
  "ambiguous",
  "duplicate",
  "failed-reviewer",
  "mixed-severity",
]);
export type FixtureTag = z.infer<typeof tagSchema>;

/**
 * One simulated specialist finding, shaped like the persisted
 * `Finding` domain type (`@/domain/types`) minus the DB-only `id`/
 * `reviewerRunId` foreign keys, which `baseline/context.ts` fills in
 * when building the real `ReviewerRun[]` the judge port consumes.
 * `id` here is a FIXTURE-LOCAL string (not a UUID) so ground truth can
 * reference a specific finding by a stable, human-readable name.
 */
export const fixtureFindingSchema = z.object({
  id: z.string().min(1),
  severity: severitySchema,
  title: z.string().min(1),
  description: z.string().min(1),
  category: z.string().min(1),
  recommendation: z.string().min(1),
  confidence: z.number().min(0).max(1),
  filePath: z.string().nullable().default(null),
  lineStart: z.number().int().positive().nullable().default(null),
  lineEnd: z.number().int().positive().nullable().default(null),
});
export type FixtureFinding = z.infer<typeof fixtureFindingSchema>;

/** One simulated specialist `ReviewerRun` — the judge's actual, real input shape. */
export const fixtureReviewerRunSchema = z.object({
  reviewer: specialistReviewerSchema,
  status: z.enum(["complete", "failed"]),
  summary: z.string().nullable(),
  findings: z.array(fixtureFindingSchema).default([]),
});
export type FixtureReviewerRun = z.infer<typeof fixtureReviewerRunSchema>;

export const expectedJudgeFixtureSchema = z
  .object({
    fixture_id: z.string().min(1),
    domain: z.string().min(1),
    tags: z.array(tagSchema).min(1),
    description: z.string().min(1),
    reviewer_runs: z.array(fixtureReviewerRunSchema).min(1),
    expected: z.object({
      /** The verdict a well-tuned Release Judge SHOULD produce — may be stricter than the deterministic floor (see `domain/verdict.ts`'s `minimumVerdictFor`), never more lenient than it. */
      verdict: verdictSchema,
      /** Human-readable ground truth for WHY. Not scored directly; used when hand-auditing a run. */
      rationale: z.string().min(1),
      /** Fixture-local finding ids (from `reviewer_runs[].findings[].id`) that represent a CONFIRMED release-blocking defect. */
      blocking_finding_ids: z.array(z.string().min(1)).default([]),
      /** Groups of >=2 fixture-local finding ids that describe the SAME root cause from different reviewers — a correct judge must not double-count them as independent risks. */
      duplicate_groups: z.array(z.array(z.string().min(1)).min(2)).default([]),
      /** Fixture-local finding ids that are low-confidence/ambiguous and must NOT be treated as a confirmed blocker. */
      low_confidence_only_finding_ids: z.array(z.string().min(1)).default([]),
      /** Whether every `REQUIRED_REVIEWERS` (`@/domain/verdict`) entry has a `status: "complete"` run in this fixture. Redundant with `reviewer_runs` itself but kept explicit so a fixture's intent is visible without re-deriving it. */
      requires_full_reviewer_coverage: z.boolean(),
      /**
       * Vocabulary describing a defect/category that is NOT grounded in
       * ANY of this fixture's own findings (title/description/category
       * text) — case-insensitive substrings the judge's `summary` must
       * never ASSERT. A hit means the judge invented a finding, since
       * `buildJudgeUserPrompt` gives it nothing else to draw from.
       * Negation-aware (`scorer.ts`'s `hasUngroundedPositiveMention`): a
       * summary correctly DENYING the term ("no P0 findings", "no
       * security defects were identified") is not a hit — only a term
       * asserted as true with no negation immediately before it counts.
       */
      hallucination_probe_terms: z.array(z.string().min(1)).default([]),
    }),
    explanation: z.string().optional(),
  })
  .superRefine((fixture, ctx) => {
    const allFindingIds = new Set(fixture.reviewer_runs.flatMap((run) => run.findings.map((f) => f.id)));

    const seenIds = new Set<string>();
    for (const run of fixture.reviewer_runs) {
      for (const finding of run.findings) {
        if (seenIds.has(finding.id)) {
          ctx.addIssue({ code: "custom", path: ["reviewer_runs"], message: `duplicate finding id "${finding.id}" across reviewer_runs` });
        }
        seenIds.add(finding.id);
      }
    }

    const checkIdsExist = (ids: readonly string[], path: string) => {
      for (const id of ids) {
        if (!allFindingIds.has(id)) {
          ctx.addIssue({ code: "custom", path: ["expected", path], message: `references finding id "${id}" which does not exist in any reviewer_runs[].findings` });
        }
      }
    };
    checkIdsExist(fixture.expected.blocking_finding_ids, "blocking_finding_ids");
    checkIdsExist(fixture.expected.low_confidence_only_finding_ids, "low_confidence_only_finding_ids");
    for (const group of fixture.expected.duplicate_groups) checkIdsExist(group, "duplicate_groups");

    const reviewersPresentComplete = new Set(fixture.reviewer_runs.filter((r) => r.status === "complete").map((r) => r.reviewer));
    const requiredReviewers: SpecialistReviewer[] = ["code", "security", "architecture", "database", "test"];
    const actuallyComplete = requiredReviewers.every((r) => reviewersPresentComplete.has(r));
    if (fixture.expected.requires_full_reviewer_coverage !== actuallyComplete) {
      ctx.addIssue({
        code: "custom",
        path: ["expected", "requires_full_reviewer_coverage"],
        message: `declared requires_full_reviewer_coverage=${fixture.expected.requires_full_reviewer_coverage} but reviewer_runs' actual complete-status coverage is ${actuallyComplete}`,
      });
    }

    if (!actuallyComplete && fixture.expected.verdict !== "DO_NOT_APPROVE") {
      ctx.addIssue({
        code: "custom",
        path: ["expected", "verdict"],
        message: "a fixture with incomplete required-reviewer coverage must expect DO_NOT_APPROVE (fail-closed, per domain/verdict.ts's checkRequiredReviewers)",
      });
    }

    const isClean = fixture.tags.includes("clean");
    if (isClean && (fixture.reviewer_runs.some((r) => r.findings.length > 0) || fixture.expected.verdict !== "APPROVE")) {
      ctx.addIssue({ code: "custom", path: ["expected"], message: '"clean"-tagged fixture must have zero findings across all reviewer_runs and expect APPROVE' });
    }
  });

export type ExpectedJudgeFixture = z.infer<typeof expectedJudgeFixtureSchema>;
