import { z } from "zod";
import type { Finding as PersistedFinding } from "@/domain/types";
import { mapNumericConfidenceToBucket } from "./confidence-mapping";
import { reviewerResultSchema, type ProducedFinding, type ReviewerResult } from "./scorer";

/**
 * Pure adapter: persisted DB `Finding[]` (`src/domain/types.ts`) →
 * `scorer.ts`'s normalized `ReviewerResult`. This is the ONLY place in
 * this module that reads a production type — `import type` only, no
 * runtime import of production code, so this stays a one-way
 * translation layer, never a dependency the production reviewer takes
 * on the benchmark.
 *
 * "Pure": no I/O, no defaults invented for missing data — malformed
 * input is rejected (thrown), never guessed at. See each field's
 * comment below for what "malformed" means for that field.
 */

/**
 * The subset of the persisted `Finding` shape this adapter actually
 * reads, validated at runtime (the DB row itself was already validated
 * once at insert time via `providerFindingSchema` in
 * `src/domain/schemas.ts` — this is a second, independent boundary
 * check specific to what THIS adapter requires, matching the
 * boundary-validation convention used everywhere else in this module).
 */
const persistedFindingInputSchema = z.object({
  severity: z.enum(["P0", "P1", "P2", "NIT"]),
  confidence: z.number(),
  filePath: z.string().nullable(),
  lineStart: z.number().int().nullable(),
  lineEnd: z.number().int().nullable(),
  category: z.string().min(1),
  description: z.string(),
});

export interface AdapterError {
  index: number;
  message: string;
}

export class AdapterValidationError extends Error {
  readonly errors: AdapterError[];
  constructor(errors: AdapterError[]) {
    super(
      `adaptPersistedFindings: ${errors.length} finding(s) failed validation — refusing to guess: ${errors
        .map((e) => `[${e.index}] ${e.message}`)
        .join("; ")}`,
    );
    this.name = "AdapterValidationError";
    this.errors = errors;
  }
}

/**
 * Converts persisted `Finding[]` rows into a `ReviewerResult` the
 * scorer can grade. Field-by-field:
 *
 * - `severity`: `"NIT"` → `"Nit"` (the only casing difference between
 *   the persisted enum and the benchmark's); `P0`/`P1`/`P2` pass through.
 * - `confidence`: the persisted numeric 0–1 value is bucketed via
 *   `mapNumericConfidenceToBucket` (the ONE canonical threshold
 *   function — see `confidence-mapping.ts`). Out-of-range values
 *   (outside `[0, 1]`) fail validation rather than being clamped.
 * - `file`: persisted `filePath` is nullable, and null is passed
 *   through as `file: null`, never replaced with an invented path.
 *   This is deliberate support, not a gap: production's own system
 *   prompt (`review-engine/providers/prompt.ts`) explicitly instructs
 *   the model to "leave filePath and line fields null" whenever it
 *   can't point to a specific line — a real, currently-active
 *   production behavior, not a hypothetical. A `null`-file finding can
 *   only ever match a ground-truth entry that opts in with
 *   `repository_scope: true` (`schema.ts`) — see the plan's §3.6.
 * - `lineStart`/`lineEnd`: pass through unchanged (already nullable
 *   ints on both sides, same start-<=-end invariant on both). If
 *   `filePath` is null but `lineStart` is not, that's a genuinely
 *   malformed combination (a line number with no file is meaningless,
 *   and contradicts the prompt's own "leave filePath AND line fields
 *   null together" instruction) — rejected, not guessed at.
 * - `category`: passes through unchanged — production's plain,
 *   unmigrated category strings are exactly what the scorer's
 *   `matchesByLocation` fallback (§4.1) is designed to accept; this
 *   adapter does not attempt to rewrite them into the canonical
 *   `domain.subcategory` format.
 * - `evidence`: mapped from persisted `description` — production has
 *   no separate `evidence` field (the aspirational spec §4 schema's
 *   richer shape, including `evidence`/`attack_preconditions`/
 *   `exploit_scenario`/etc., was never implemented; production's
 *   actual `AgentReviewOutput`/`Finding` only has `description`). This
 *   is a real, deliberate simplification, not a guess: `description`
 *   is where a real reviewer's account of the vulnerable code
 *   actually lives today. The scorer's `fabricated_evidence` check
 *   (`scorer.ts` §4.1) only evaluates backtick-quoted spans within
 *   this text, never free prose — a `description` that paraphrases
 *   throughout, with no backtick-quoted code, is never flagged.
 * - `ruleId`: never invented. Production doesn't emit one; every
 *   adapted finding has `ruleId: undefined`, which routes it through
 *   the scorer's file/line fallback path (§4.1) — exactly the
 *   "current production reviewer can be benchmarked without production
 *   changes" requirement this adapter exists to satisfy.
 * - `evidenceState` / `securityConsequence` / `attackPreconditions` /
 *   `exploitScenario` / `standards`: never invented, for the same
 *   reason as `ruleId` — production's persisted `Finding` shape
 *   (`src/domain/types.ts`) has no such fields at all today, so every
 *   adapted finding leaves all five `undefined`. This is the
 *   "represent as unavailable/unknown" requirement from Task 1/2,
 *   concretely: `scoreFixture`'s `evidenceStateDiagnostics` reports a
 *   P0/P1 finding with `evidenceState: undefined` as `"not measurable"`
 *   (`p0p1NotMeasurable`), never as a violation — an unmodified
 *   production run must never be penalized for a signal it structurally
 *   cannot supply. The three chain-narrative fields and `standards`
 *   feed `deferred-metrics.ts`'s exploit-path-validity/
 *   standards-mapping-accuracy metrics, which report `"not_measurable"`
 *   for the same reason. **Known limitation, not a bug:** until
 *   production's review engine emits these fields itself, no adapted
 *   real-reviewer run can ever be scored against the evidence-state/
 *   chain-quality rules this refresh added — only a benchmark harness
 *   for a reviewer that emits `ReviewerResult` directly (bypassing this
 *   adapter) can exercise them today.
 *
 * `needsMoreContext` is always `false` — production has no concept of
 * the spec's §4.4 `needs_more_context` status object at all (there is
 * nowhere in `ReviewerRun`/`Finding` this signal could come from). This
 * is a real gap, not a guess: an `ambiguous` fixture can currently only
 * ever be judged on "zero findings vs. a finding" against real
 * production output, never on an explicit needs-more-context signal.
 *
 * Throws `AdapterValidationError` (never returns a partial/guessed
 * result) if any input finding is malformed or unsupported.
 */
export function adaptPersistedFindings(findings: readonly PersistedFinding[]): ReviewerResult {
  const errors: AdapterError[] = [];
  const adapted: ProducedFinding[] = [];

  findings.forEach((raw, index) => {
    const parsed = persistedFindingInputSchema.safeParse(raw);
    if (!parsed.success) {
      errors.push({ index, message: parsed.error.issues.map((issue) => issue.message).join("; ") });
      return;
    }
    const finding = parsed.data;

    if (finding.filePath === null && finding.lineStart !== null) {
      errors.push({
        index,
        message: "lineStart is set while filePath is null — a line number with no file is malformed, not guessable",
      });
      return;
    }

    if (finding.confidence < 0 || finding.confidence > 1 || !Number.isFinite(finding.confidence)) {
      errors.push({ index, message: `confidence must be a finite number in [0, 1], got ${finding.confidence}` });
      return;
    }

    adapted.push({
      category: finding.category,
      severity: finding.severity === "NIT" ? "Nit" : finding.severity,
      confidence: mapNumericConfidenceToBucket(finding.confidence),
      file: finding.filePath,
      lineStart: finding.lineStart,
      lineEnd: finding.lineEnd,
      evidence: finding.description,
      // Deliberately omitted, never guessed — see the doc comment above.
    });
  });

  if (errors.length > 0) {
    throw new AdapterValidationError(errors);
  }

  return reviewerResultSchema.parse({ needsMoreContext: false, findings: adapted });
}
