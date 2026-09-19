import { z } from "zod";
import { normalizeCategory } from "./category-compat";
import type { LoadedFixture } from "./load-fixtures";
import {
  CONFIDENCE_RANK,
  SEVERITY_RANK,
  confidenceSchema,
  evidenceStateSchema,
  severitySchema,
  type Confidence,
  type EvidenceState,
  type ExpectedFixture,
  type FixtureTag,
  type GroundTruthFinding,
  type Severity,
} from "./schema";

/**
 * Deterministic benchmark scorer — see `docs/agents/security-benchmark-plan.md`
 * §4. Never calls a model; grades a reviewer's already-produced,
 * structured output against a fixture's `expected.json`. Deliberately
 * outside `src/server/review-engine/` — this scores benchmark runs, it
 * is never imported by the production review engine.
 */

// ---------------------------------------------------------------------------
// Reviewer result — the normalized input this scorer consumes
// ---------------------------------------------------------------------------

/**
 * The spec's §1 standards baselines this benchmark can currently
 * validate a citation's ID *format* against. Deliberately excludes the
 * OWASP Top 10 for Agentic Applications (`ASI01`–`ASI10`, spec §1.6):
 * that standard's own item list is explicitly flagged in the spec as
 * **not independently confirmed against a primary OWASP source**
 * (third-party-sourced only) — validating a format for it would imply
 * a confidence in the ID scheme this benchmark doesn't have, exactly
 * the "invented control ID" this schema exists to prevent (see the
 * plan's Task 7 note). Add `"owasp-agentic-top10"` here once the spec's
 * own §1.6 verification gap is resolved.
 */
export const standardsFrameworkSchema = z.enum(["owasp-top10", "owasp-api-top10", "asvs", "cwe", "owasp-llm-top10"]);
export type StandardsFramework = z.infer<typeof standardsFrameworkSchema>;

/**
 * Per-framework ID shape, taken directly from the spec's §1 tables —
 * NOT a semantic "does this ID actually exist/apply" check (that's the
 * Deferred "standards-mapping accuracy" metric, `deferred-metrics.ts`),
 * only a syntactic guard against an obviously fabricated ID (e.g.
 * `"CWE-abc"`, `"A99:2025"`). A citation whose `id` doesn't match its
 * own `framework`'s pattern fails `standardsCitationSchema` outright —
 * this is what makes "no invented standards IDs, no free-form guessing"
 * (Task 2) an enforced schema rule rather than only a stated intention.
 */
const STANDARDS_ID_PATTERNS: Record<StandardsFramework, RegExp> = {
  "owasp-top10": /^A(0[1-9]|10):20\d{2}$/, // e.g. "A01:2025" — spec §1.1
  "owasp-api-top10": /^API(10|[1-9]):20\d{2}$/, // e.g. "API1:2023" — spec §1.2
  asvs: /^ASVS-5\.0-\d{1,2}(\.\d+){0,2}$/, // e.g. "ASVS-5.0-8.1.1" — spec §1.3
  cwe: /^CWE-\d+$/, // e.g. "CWE-89" — spec §1.4
  "owasp-llm-top10": /^LLM(10|0[1-9]):20\d{2}$/, // e.g. "LLM01:2026" — spec §1.5
};

/**
 * One `standards` mapping on a produced finding (Task 2) — `framework`
 * says which of §1's baselines `id` is drawn from, `version` is the
 * baseline's own version string (e.g. `"2025"`, `"5.0.0"`) when the
 * producer knows it, omitted otherwise (never guessed). Format-only
 * validation, matching `STANDARDS_ID_PATTERNS` — see that constant's
 * comment for what this does and doesn't check.
 */
export const standardsCitationSchema = z
  .object({
    framework: standardsFrameworkSchema,
    id: z.string().min(1),
    version: z.string().min(1).optional(),
  })
  .refine((citation) => STANDARDS_ID_PATTERNS[citation.framework].test(citation.id), {
    message: "standards citation id does not match its framework's known id format — no invented/free-form standards ids",
    path: ["id"],
  });
export type StandardsCitation = z.infer<typeof standardsCitationSchema>;

/**
 * One produced finding, in the shape of the spec's own §4 raw
 * AI-output schema (category/severity/confidence/file/line/evidence) —
 * NOT the persisted DB `Finding` shape in `src/domain/types.ts` (which
 * uses a numeric 0–1 confidence and an uppercase `"NIT"` severity); see
 * `adapter.ts` for that translation.
 */
export const producedFindingSchema = z
  .object({
    /**
     * Free-form — NOT validated against `categorySchema`'s canonical
     * `domain.subcategory` format. Today's production reviewer emits
     * plain, unmigrated strings (`"access-control"`, not
     * `"access-control.idor"`); the scorer's `category-compat.ts`
     * layer bridges the gap deterministically where unambiguous (see
     * the plan's §3.3).
     */
    category: z.string().min(1),
    severity: severitySchema,
    confidence: confidenceSchema,
    /**
     * `null` for a repository-wide/configuration finding not tied to
     * one specific file — a real, currently-active production
     * behavior (the reviewer's system prompt instructs it to leave
     * `filePath`/line fields null when it can't point to a specific
     * line; see `adapter.ts` and the plan §3.6). Only matches a
     * ground-truth entry with `repository_scope: true`. A non-null
     * `file` must be one of the fixture's declared `files` to avoid a
     * `hallucinated_path` classification.
     */
    file: z.string().min(1).nullable(),
    lineStart: z.number().int().positive().nullable(),
    lineEnd: z.number().int().positive().nullable(),
    /**
     * A description of the code that triggered this finding — NOT
     * required to be a verbatim quote (see the plan's §4.1 rewrite,
     * "Fabricated-evidence detection"). Only a backtick-quoted `` `code
     * span` `` within this text is ever checked against the fixture's
     * actual source; prose outside backticks is never flagged as
     * fabricated, however much it paraphrases. Empty is allowed by
     * this schema (it's a "speculative" finding, not a hallucination)
     * but always penalized in scoring.
     */
    evidence: z.string(),
    /**
     * Optional, free-form — NOT validated against `ruleIdSchema`'s
     * `SEC-<DOMAIN>-NNN` format. Today's production reviewer doesn't
     * emit a rule id at all (see `adapter.ts`), so this must accept
     * "absent" cleanly; when a benchmark harness for some *other*
     * reviewer does supply one, matching (§4.1) treats it as
     * authoritative — an exact match wins outright, and a WRONG one
     * blocks the file/line fallback rather than being silently ignored.
     */
    ruleId: z.string().min(1).optional(),
    /**
     * Task 1. Optional — absent for today's unmodified production
     * output (production has no such field at all; `adapter.ts` never
     * invents one, see its own doc comment). When absent on a P0/P1
     * finding, `scoreFixture` reports it as `"not measurable"`
     * diagnostics (`evidenceStateDiagnostics`), never as a violation —
     * penalizing an absence production structurally cannot supply would
     * unfairly fail every unmodified production run. When present and
     * equal to `"needs_more_context"`, the finding is classified
     * `"insufficient_evidence"` and can NEVER match a required/optional
     * ground-truth entry, regardless of category/file/line/ruleId —
     * "needs_more_context must never be treated as a confirmed
     * vulnerability" (Task 1) is enforced by construction, not by a
     * downstream score adjustment. See `scoreFixture`'s classification
     * order for exactly where this check runs.
     */
    evidenceState: evidenceStateSchema.optional(),
    /**
     * Task 2 — the spec's §4 "inferred consequence" field, kept
     * distinct from `evidence` (observed fact only). Optional and
     * currently always absent from adapted production output (see
     * `adapter.ts`) — never invented when missing.
     */
    securityConsequence: z.string().min(1).optional(),
    /** Task 2 — the spec's §4 `attack_preconditions` field. Same absence rule as `securityConsequence`. */
    attackPreconditions: z.string().min(1).optional(),
    /** Task 2 — the spec's §4 `exploit_scenario` field. Same absence rule as `securityConsequence`. */
    exploitScenario: z.string().min(1).optional(),
    /**
     * Task 2 — the spec's §4 `standards` field, zero or more
     * `standardsCitationSchema` entries. Absent (not an empty array)
     * when the producer supplies none — an empty array would claim "I
     * checked and nothing applies," which is a different, stronger
     * claim than "this field isn't populated"; only the schema
     * distinguishes the two, `scorer.ts`/`deferred-metrics.ts` treat
     * both as "not available" for now (standards-mapping accuracy is
     * Deferred — see the plan §1).
     */
    standards: z.array(standardsCitationSchema).min(1).optional(),
  })
  .refine((finding) => finding.lineStart !== null || finding.lineEnd === null, {
    message: "lineEnd must be null when lineStart is null (an absence-only finding has no line at all)",
    path: ["lineEnd"],
  })
  .refine((finding) => finding.lineStart === null || finding.lineEnd === null || finding.lineStart <= finding.lineEnd, {
    message: "lineStart must be <= lineEnd",
    path: ["lineEnd"],
  })
  .refine((finding) => finding.file !== null || finding.lineStart === null, {
    message: "lineStart must be null when file is null — a line number with no file is meaningless",
    path: ["lineStart"],
  });
export type ProducedFinding = z.infer<typeof producedFindingSchema>;

export const reviewerResultSchema = z.object({
  /**
   * Whether the reviewer explicitly emitted §4.4's `needs_more_context`
   * status instead of (or alongside) findings. Carried through for
   * whichever future reviewer/harness can supply it, but deliberately
   * NOT consulted anywhere in `scoreFixture`'s scoring logic today —
   * an `ambiguous` fixture's pass/fail is judged entirely from the
   * `findings` array (zero findings, or a single low-confidence
   * optional match, both pass; a confident finding doesn't). Today's
   * production reviewer has no way to set this at all (`adapter.ts`
   * always defaults it `false`), so scoring must never treat its
   * absence as a penalty — see the plan §3.7.
   */
  needsMoreContext: z.boolean().default(false),
  findings: z.array(producedFindingSchema).default([]),
});
export type ReviewerResult = z.infer<typeof reviewerResultSchema>;

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export type FindingClassification =
  | "matched_required"
  | "matched_optional"
  | "duplicate"
  | "prohibited"
  | "unsupported_extra"
  | "hallucinated_path"
  | "fabricated_evidence"
  /**
   * Task 1/5. The finding's own `evidenceState` is `"needs_more_context"`
   * — scored as a neutral, correct, cautious result (0 score effect: not
   * a false positive, but never a required/optional match either,
   * "cannot receive full credit" per Task 5). Checked before rule_id/
   * category/location matching runs at all, so this overrides every
   * other classification a location/category match would otherwise have
   * produced.
   */
  | "insufficient_evidence";

/** How a matched/duplicate finding was actually resolved to a ground-truth entry — see the plan's §5 compatibility report. `"unmatched"` covers every non-match classification (prohibited, unsupported_extra, hallucinated_path, fabricated_evidence, insufficient_evidence). */
export type MatchMethod = "rule_id" | "canonical_category_location" | "compatibility_category_location" | "unmatched";

export interface ClassifiedFinding {
  finding: ProducedFinding;
  /** Position in the produced findings array, for stable reporting. */
  index: number;
  classification: FindingClassification;
  /** The ground-truth finding id this matched or duplicated, if any. */
  matchedId: string | null;
  /** Evidence was empty after trimming — penalized regardless of classification, tracked separately. */
  speculative: boolean;
  /** How the match (if any) was found — see `MatchMethod`. */
  matchMethod: MatchMethod;
  /** `category-compat.ts`'s mapping of `finding.category`, if any exists — always the RAW category is what's on `finding.category` itself; this is never invented, only looked up. */
  normalizedCategory: string | undefined;
  /** Whether the category-compatibility layer (as opposed to the finding's raw category alone) changed the outcome — a match, or an allowed/prohibited decision. See the plan's §5. */
  compatibilityApplied: boolean;
}

function severityRangeIncludes(range: readonly [Severity, Severity], severity: Severity): boolean {
  const rank = SEVERITY_RANK[severity];
  return SEVERITY_RANK[range[0]] <= rank && rank <= SEVERITY_RANK[range[1]];
}

// ---------------------------------------------------------------------------
// Fabricated-evidence detection (plan §4.1)
// ---------------------------------------------------------------------------

const CODE_QUOTE_PATTERN = /`([^`]+)`/g;

/**
 * A short marker immediately before a backtick-quoted span that signals
 * "what follows is an illustrative example, not a claim about this
 * diff's actual content" — e.g. "...break out of the string literal
 * (e.g. `' OR '1'='1`)". Deliberately narrow (a handful of common,
 * unambiguous phrasings) rather than any heuristic guess at "sounds like
 * an example" — see `isIllustrativeExample`'s doc comment (Task: fix
 * confirmed scorer defects, item 2).
 */
const ILLUSTRATIVE_EXAMPLE_MARKER = /\b(?:e\.g\.,?|for example,?|such as|like)\s*$/i;

/**
 * A span shaped like a reference to a SPECIFIC named piece of code — a
 * function call (`validateOwnership(...)`) or a bare identifier
 * (`ownerId`) — as opposed to illustrative DATA (an attack-payload
 * string, a sample value). Used to keep `isIllustrativeExample` narrow:
 * an "e.g." marker excuses a payload-shaped example, never a
 * code-reference-shaped one — otherwise "e.g." could launder a
 * genuinely fabricated function/variable reference past the check.
 */
const CODE_REFERENCE_SHAPE_PATTERN = /^[A-Za-z_$][\w$]*\s*\(|^[A-Za-z_$][\w$]*$/;

/**
 * A bare dotted identifier/API-reference chain — `pg.Pool.query`,
 * `foo.bar.baz` — and nothing else: no parentheses, spaces, quotes, or
 * operators. Deliberately excludes anything that could be an actual
 * expression or statement (which must still be verified verbatim) —
 * this pattern only matches the shape of "a name for an API," never
 * "a piece of code that runs."
 */
const DOTTED_IDENTIFIER_PATTERN = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/;

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function stripTrailingPunctuation(text: string): string {
  return text.replace(/[;,]+$/, "");
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface QuotedSpan {
  span: string;
  /** Verbatim text immediately preceding the opening backtick (a bounded window) — read only by `isIllustrativeExample`. */
  precedingContext: string;
}

/**
 * Every backtick-quoted `` `span` `` in `evidence`, each paired with the
 * text immediately before it — the ONLY part of a produced finding's
 * evidence this scorer ever treats as a checkable "this exact code
 * exists" claim. Prose outside backticks is a paraphrase, not a
 * quotation, and is never checked this way — see `hasFabricatedCodeClaim`'s
 * doc comment for why.
 */
function extractQuotedCodeSpans(evidence: string): QuotedSpan[] {
  const spans: QuotedSpan[] = [];
  for (const match of evidence.matchAll(CODE_QUOTE_PATTERN)) {
    const span = collapseWhitespace(match[1]);
    if (span.length === 0) continue;
    const matchIndex = match.index ?? 0;
    spans.push({ span, precedingContext: evidence.slice(Math.max(0, matchIndex - 24), matchIndex) });
  }
  return spans;
}

/**
 * Whether a span is explicitly flagged, by its own immediately-preceding
 * text, as an illustrative example rather than a claim about this
 * diff's actual content — e.g. an attack-payload sample introduced with
 * "e.g." Deliberately narrow in two independent ways, so an "e.g."
 * can never be used to smuggle a fabricated code claim past this check:
 * 1. Only a short, fixed list of unambiguous markers counts (see
 *    `ILLUSTRATIVE_EXAMPLE_MARKER`) — a span with no such marker is
 *    always held to the full verbatim-quote standard.
 * 2. Even WITH a marker, a span shaped like a reference to a specific
 *    named function/variable (`CODE_REFERENCE_SHAPE_PATTERN`) is still
 *    NOT exempted — "e.g. `validateOwnership()`" still gets verified,
 *    because "e.g." there reads as introducing a claim about this
 *    diff's code, not illustrative data. Only a payload/data-shaped span
 *    (an attack string, a sample value — not a bare identifier or call)
 *    is actually excused.
 */
function isIllustrativeExample(precedingContext: string, span: string): boolean {
  return ILLUSTRATIVE_EXAMPLE_MARKER.test(precedingContext) && !CODE_REFERENCE_SHAPE_PATTERN.test(span);
}

/**
 * Whether `span` is a bare dotted API/identifier reference (`pg.Pool.query`)
 * where EVERY dot-separated segment is independently a real token
 * somewhere in `sourceText` — even though the exact dotted concatenation
 * never has to appear verbatim. This is what distinguishes "naming a
 * real API generically" from "inventing a plausible-looking but
 * nonexistent path": each piece must be real and checkable
 * case-sensitively (identifiers ARE case-sensitive, unlike the
 * whole-phrase comparison in `hasFabricatedCodeClaim` below) — only the
 * requirement that they appear pre-assembled, in that exact order, is
 * relaxed. A span containing anything beyond a plain dotted chain
 * (parens, operators, quotes, spaces) never matches this at all and
 * stays fully subject to the verbatim check.
 */
function isVerifiableApiReference(span: string, sourceText: string): boolean {
  if (!DOTTED_IDENTIFIER_PATTERN.test(span)) return false;
  return span.split(".").every((segment) => new RegExp(`\\b${escapeForRegExp(segment)}\\b`).test(sourceText));
}

/**
 * Whether `finding.evidence` contains a deterministically-provable
 * fabrication.
 *
 * Only backtick-quoted spans are checked (see `extractQuotedCodeSpans`)
 * — a span is "fabricated" when, after whitespace collapsing, stripping
 * a single trailing `;`/`,`, and case-folding, it is not a substring of
 * `sourceText` (similarly normalized), AND it isn't exempted as either
 * an illustrative example (`isIllustrativeExample`) or a verifiable
 * dotted API reference (`isVerifiableApiReference`). This is
 * deliberately narrower than the original "the whole evidence string
 * must appear verbatim" check: free prose describing/paraphrasing the
 * code (no backticks at all) is NEVER checked here — there is no
 * deterministic way to verify a paraphrase is "true," so per the plan's
 * rule, when verification can't establish fabrication, this function
 * returns `false` and the finding proceeds through normal matching
 * instead of being disqualified. A backtick-quoted span is different:
 * quoting code in backticks is an explicit claim that "this is what the
 * code says," which — unlike a paraphrase — genuinely IS a checkable,
 * either-true-or-false fact. Only that explicit claim is graded.
 *
 * **Case-folding, added after a real production run surfaced it: a
 * genuinely accurate quote is never flagged merely because the model
 * re-cased it** (most commonly SQL keywords — a model writing `ALTER
 * TABLE ... ENABLE ROW LEVEL SECURITY` in the conventional uppercase
 * style when the source itself is lowercase). This does not weaken
 * detection of an actually-invented identifier or behavior: an invented
 * span is absent from the source in EVERY case-folding, not merely
 * differently-cased — see `scorer.test.ts`'s regression tests for both
 * the case-insensitive-match and the still-flagged-when-truly-absent
 * cases side by side.
 *
 * **Illustrative-example and dotted-API-reference exemptions, added for
 * the same reason:** a real reviewer legitimately uses backticks for
 * markdown code-formatting of an attack-payload example ("e.g.
 * `' OR '1'='1`") or a generic library reference ("`pg.Pool.query`
 * supports parameterized queries") without intending either as a quote
 * of this diff's actual text. Both exemptions are narrow and additive —
 * a span that doesn't match either shape (an actual code-like fragment
 * with no example marker) is held to the full verbatim standard, same
 * as before.
 *
 * Any single unfound, unexempted quoted span is enough to flag the
 * whole finding — one false claim is sufficient to prove fabrication,
 * even alongside other, accurate spans.
 */
function hasFabricatedCodeClaim(finding: ProducedFinding, sourceText: string): boolean {
  const spans = extractQuotedCodeSpans(finding.evidence);
  if (spans.length === 0) return false;
  const normalizedSource = collapseWhitespace(sourceText).toLowerCase();
  return spans.some(({ span, precedingContext }) => {
    const candidate = stripTrailingPunctuation(span);
    if (candidate.length === 0) return false;
    if (normalizedSource.includes(candidate.toLowerCase())) return false;
    if (isIllustrativeExample(precedingContext, candidate)) return false;
    if (isVerifiableApiReference(candidate, sourceText)) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Category compatibility (plan §3.3 / §4.1)
// ---------------------------------------------------------------------------

/** Whether `findingCategory` is equal to `entryCategory`, either directly (the raw/canonical string) or via `category-compat.ts`'s legacy mapping. */
function categoryMatchesEntry(findingCategory: string, entryCategory: string): boolean {
  if (findingCategory === entryCategory) return true;
  const normalized = normalizeCategory(findingCategory);
  return normalized !== undefined && normalized === entryCategory;
}

/** Whether `findingCategory` is a member of `set`, either directly or via compatibility mapping. */
function categoryInSet(findingCategory: string, set: ReadonlySet<string>): boolean {
  if (set.has(findingCategory)) return true;
  const normalized = normalizeCategory(findingCategory);
  return normalized !== undefined && set.has(normalized);
}

// ---------------------------------------------------------------------------
// Location matching (plan §4.1)
// ---------------------------------------------------------------------------

/**
 * Ids of ground-truth entries (drawn from BOTH pools combined) that
 * share overlapping `files`/`line_ranges` with at least one sibling —
 * mirrors `schema.ts`'s own overlap check, scoped here to decide when
 * `matchesByLocation` should even bother gating on `category` at all.
 *
 * Why gate conditionally rather than "whenever `entry.category` is
 * set": most ground-truth entries have a `category` set purely for
 * clarity/consistency, not because anything actually overlaps them —
 * enforcing exact category equality in those cases would make the
 * benchmark unfairly strict against a real reviewer that correctly
 * located the right file/line but used a different (even if entirely
 * reasonable) category label. The category gate is only load-bearing
 * — and only enforced — for the entries that genuinely need it to be
 * told apart from a sibling.
 */
function findEntriesNeedingDisambiguation(entries: readonly GroundTruthFinding[]): ReadonlySet<string> {
  const needsDisambiguation = new Set<string>();
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i];
      const b = entries[j];
      const sharedFiles = a.files.filter((file) => b.files.includes(file));
      if (sharedFiles.length === 0) continue;
      const overlaps = sharedFiles.some((file) => {
        const rangeA = a.line_ranges?.[file];
        const rangeB = b.line_ranges?.[file];
        if (rangeA === undefined || rangeA === null || rangeB === undefined || rangeB === null) return true;
        return rangeA[0] <= rangeB[1] && rangeB[0] <= rangeA[1];
      });
      if (overlaps) {
        needsDisambiguation.add(a.id);
        needsDisambiguation.add(b.id);
      }
    }
  }
  return needsDisambiguation;
}

/**
 * Whether a produced finding falls inside a ground-truth entry's
 * declared region — the §4.1 FALLBACK match test, used only when the
 * produced finding didn't supply a `ruleId` (see `pickMatch` below for
 * the full priority order).
 *
 * `categoryCheck` selects which category-equality test to apply
 * (`categoryMatchesEntry` allows the compatibility mapping;
 * a raw-only check does not) — `pickMatch` tries the stricter,
 * canonical-only check first and only falls back to the
 * compatibility-aware one if that finds nothing, so the caller can
 * report which one actually mattered (plan §5).
 *
 * `finding.file === null` (a repository-wide/configuration finding,
 * see `producedFindingSchema`) can only match an entry with
 * `repository_scope: true`, and skips the line-range test entirely —
 * there is no line to compare. A `line_ranges` entry that's absent for
 * a given file (or the whole `line_ranges` map is absent) means "no
 * line constraint for this file" — file membership alone is enough
 * (matches the spec's own `line: null` "absence" finding case, e.g.
 * "no RLS policy exists"). A produced finding with `lineStart: null`
 * (but a real `file`) can only match a ground-truth region that itself
 * has no line constraint.
 */
function matchesByLocation(
  finding: ProducedFinding,
  entry: GroundTruthFinding,
  needsDisambiguation: ReadonlySet<string>,
  categoryCheck: (findingCategory: string, entryCategory: string) => boolean,
): boolean {
  if (finding.file === null) {
    if (!entry.repository_scope) return false;
  } else if (!entry.files.includes(finding.file)) {
    return false;
  }

  // Checked against the entry's FULL category set (`category` plus any
  // hand-authored `alternate_categories` — schema.ts's own doc comment
  // explains why this is safe: overlapping siblings are schema-enforced
  // to have fully disjoint sets, so an alternate here can never resolve
  // to more than one entry).
  const acceptableCategories = [entry.category, ...(entry.alternate_categories ?? [])].filter(
    (c): c is string => c !== undefined,
  );
  if (acceptableCategories.length > 0 && needsDisambiguation.has(entry.id) && !acceptableCategories.some((c) => categoryCheck(finding.category, c))) {
    return false;
  }

  if (finding.file === null) return true; // no line to compare

  const range = entry.line_ranges?.[finding.file];
  if (range === undefined || range === null) return true;
  if (finding.lineStart === null) return false;
  const producedEnd = finding.lineEnd ?? finding.lineStart;
  const [start, end] = range;
  return finding.lineStart <= end && start <= producedEnd;
}

interface MatchResult {
  entry: GroundTruthFinding;
  method: Exclude<MatchMethod, "unmatched">;
}

/**
 * §4.1's matching order, run against one ground-truth pool (required
 * or optional):
 *
 * 1. **`rule_id`** — if the produced finding supplies a `ruleId`, look
 *    for the ONE entry in this pool whose own `rule_id` equals it
 *    exactly (schema-enforced unique within the fixture) — authoritative,
 *    skips file/line/category entirely. If a `ruleId` was supplied but
 *    doesn't equal any entry in this pool, this pool yields NO match —
 *    a wrong rule_id must not be silently accepted just because the
 *    location happens to match some other entry; the caller does NOT
 *    fall through to step 2 for this finding.
 * 2. **canonical category + location** — no `ruleId` supplied: try
 *    `matchesByLocation` using the RAW-category-only equality test.
 * 3. **compatibility category + location** — only if step 2 found
 *    nothing at all: retry with the compatibility-aware equality test
 *    (`category-compat.ts`). This is what lets today's unmodified
 *    production reviewer — which emits legacy category strings, no
 *    `rule_id` — still be benchmarked, while keeping the *canonical*
 *    match method distinguishable from the *compatibility* one for
 *    reporting (plan §5). A GENERIC compatibility category
 *    (`"access-control.generic"`) is still just one exact string —
 *    it can never satisfy `categoryMatchesEntry` against a SPECIFIC
 *    sibling category (`"access-control.idor"`), so it can never
 *    wrongly disambiguate two overlapping entries; it can only ever
 *    match an entry whose declared category is itself generic.
 *
 * Prefers an unconsumed candidate; falls back to an already-consumed
 * one so the caller can classify it as a duplicate.
 */
function pickMatch(
  entries: readonly GroundTruthFinding[],
  consumed: ReadonlySet<string>,
  finding: ProducedFinding,
  needsDisambiguation: ReadonlySet<string>,
): MatchResult | undefined {
  if (finding.ruleId) {
    const byRuleId = entries.find((entry) => entry.rule_id === finding.ruleId);
    return byRuleId ? { entry: byRuleId, method: "rule_id" } : undefined;
  }

  const pickFrom = (candidates: GroundTruthFinding[]): GroundTruthFinding | undefined =>
    candidates.length === 0 ? undefined : (candidates.find((entry) => !consumed.has(entry.id)) ?? candidates[0]);

  const canonicalCandidates = entries.filter((entry) =>
    matchesByLocation(finding, entry, needsDisambiguation, (f, e) => f === e),
  );
  const canonicalPick = pickFrom(canonicalCandidates);
  if (canonicalPick) return { entry: canonicalPick, method: "canonical_category_location" };

  const compatCandidates = entries.filter((entry) =>
    matchesByLocation(finding, entry, needsDisambiguation, categoryMatchesEntry),
  );
  const compatPick = pickFrom(compatCandidates);
  if (compatPick) return { entry: compatPick, method: "compatibility_category_location" };

  return undefined;
}

// ---------------------------------------------------------------------------
// Per-fixture scoring
// ---------------------------------------------------------------------------

/**
 * Task 5 diagnostics — computed over EVERY produced finding with
 * `severity` P0 or P1 (not only matched ones; a prohibited or
 * unsupported_extra high-severity finding is just as worth flagging).
 * `notMeasurable` and `violations` are mutually exclusive with
 * `measurable` (every P0/P1 finding falls into exactly one).
 */
export interface EvidenceStateDiagnostics {
  /** Total produced findings with severity P0 or P1. */
  p0p1Total: number;
  /** P0/P1 findings whose `evidenceState` is `"proven"` or `"strongly_supported"` — a valid pairing per spec §4.1. */
  p0p1Measurable: number;
  /** P0/P1 findings with no `evidenceState` at all — "not measurable" (Task 5): today's unmodified production output, never penalized for this absence. */
  p0p1NotMeasurable: number;
  /** P0/P1 findings whose `evidenceState` is explicitly `"needs_more_context"` — the exact pairing violation spec §4.1 warns about; these are also classified `"insufficient_evidence"` in `allFindings`/`insufficientEvidenceFindings`. */
  p0p1Violations: number;
}

export interface FixtureScore {
  fixtureId: string;
  domain: string;
  tags: FixtureTag[];
  /** No hard failure, zero required findings missed, zero prohibited findings, zero unsupported extras. */
  passed: boolean;
  /** hallucinated_path or fabricated_evidence present anywhere — disqualifying regardless of score (see §4.4). */
  hardFailure: boolean;
  rawScore: number;
  /** rawScore clamped to [-5, maxPossible] and rescaled to [0, 1]; forced to 0 on a hard failure. */
  normalizedScore: number;
  requiredFindingsDetected: string[];
  requiredFindingsMissed: string[];
  optionalFindingsAccepted: string[];
  falsePositives: ClassifiedFinding[];
  prohibitedFindings: ClassifiedFinding[];
  duplicates: ClassifiedFinding[];
  hallucinatedPaths: ClassifiedFinding[];
  fabricatedEvidence: ClassifiedFinding[];
  speculativeFindings: ClassifiedFinding[];
  /** Task 1/5 — findings whose own `evidenceState` is `"needs_more_context"`; never a required/optional match, never a false positive either. */
  insufficientEvidenceFindings: ClassifiedFinding[];
  /** Task 5 — evidence-state coverage/violation counts over every produced P0/P1 finding on this fixture. */
  evidenceStateDiagnostics: EvidenceStateDiagnostics;
  /** Every produced finding's classification, in original order — the raw material for `buildCompatibilityReport` (plan §5) and for any other diagnostic view a caller wants. */
  allFindings: ClassifiedFinding[];
  /** Computed only over matched_required findings — see the plan §4.3 for why optional matches are excluded. */
  severityAccuracy: { correct: number; inflated: number; understated: number };
  /** One data point per produced finding, for suite-wide confidence-calibration bucketing. */
  confidenceObservations: Array<{ confidence: Confidence; correct: boolean }>;
  requiredSeverityBreakdown: { p0Total: number; p0Matched: number; p1Total: number; p1Matched: number };
}

function findEntry(entries: readonly GroundTruthFinding[], id: string): GroundTruthFinding {
  const entry = entries.find((candidate) => candidate.id === id);
  if (!entry) {
    throw new Error(`internal scorer error: no ground-truth entry with id "${id}" — this should be unreachable`);
  }
  return entry;
}

export function scoreFixture(fixture: LoadedFixture, result: ReviewerResult): FixtureScore {
  const manifest: ExpectedFixture = fixture.manifest;
  const knownFiles = new Set(manifest.files);
  const isAmbiguous = manifest.expected.needs_more_context_acceptable;
  const isSafe = manifest.tags.includes("safe") || manifest.tags.includes("false_positive_trap");
  const allowedCategories = new Set(manifest.expected.allowed_categories);
  const prohibitedCategories = new Set(manifest.expected.prohibited_categories);
  const needsDisambiguation = findEntriesNeedingDisambiguation([
    ...manifest.expected.required_findings,
    ...manifest.expected.optional_findings,
  ]);
  const allSourceText = Object.values(fixture.sourceFiles).join("\n");

  const requiredConsumedBy = new Map<string, number>();
  const optionalConsumedBy = new Map<string, number>();
  const classified: ClassifiedFinding[] = [];

  result.findings.forEach((finding, index) => {
    const normalizedCategory = normalizeCategory(finding.category);

    if (finding.file !== null && !knownFiles.has(finding.file)) {
      classified.push({
        finding,
        index,
        classification: "hallucinated_path",
        matchedId: null,
        speculative: false,
        matchMethod: "unmatched",
        normalizedCategory,
        compatibilityApplied: false,
      });
      return;
    }

    const trimmedEvidence = finding.evidence.trim();
    if (trimmedEvidence.length > 0) {
      // No specific file to check a repository-scope finding's quoted
      // spans against — check across every declared source file instead.
      const sourceText = finding.file !== null ? (fixture.sourceFiles[finding.file] ?? "") : allSourceText;
      if (hasFabricatedCodeClaim(finding, sourceText)) {
        classified.push({
          finding,
          index,
          classification: "fabricated_evidence",
          matchedId: null,
          speculative: false,
          matchMethod: "unmatched",
          normalizedCategory,
          compatibilityApplied: false,
        });
        return;
      }
    }
    const speculative = trimmedEvidence.length === 0;

    // Task 1/5 — "needs_more_context must never be treated as a
    // confirmed vulnerability": checked before rule_id/category/location
    // matching runs at all, so a finding carrying this evidence state
    // can never land in matched_required/matched_optional no matter how
    // well its file/line/category/ruleId would otherwise line up.
    if (finding.evidenceState === "needs_more_context") {
      classified.push({
        finding,
        index,
        classification: "insufficient_evidence",
        matchedId: null,
        speculative,
        matchMethod: "unmatched",
        normalizedCategory,
        compatibilityApplied: false,
      });
      return;
    }

    // Applied once, uniformly, before either the rule_id or the
    // file/line fallback path runs: on an ambiguous fixture, ONLY a
    // "low"-confidence finding can ever match anything (its
    // optional_findings[] entries are schema-enforced to expect
    // exactly that). A confident finding here isn't a correct match
    // via either path — it's the overconfidence violation itself,
    // handled below by the fallthrough to "prohibited."
    const ambiguousBlocksMatch = isAmbiguous && finding.confidence !== "low";

    const requiredMatch = ambiguousBlocksMatch
      ? undefined
      : pickMatch(manifest.expected.required_findings, new Set(requiredConsumedBy.keys()), finding, needsDisambiguation);
    if (requiredMatch) {
      const { entry, method } = requiredMatch;
      const compatibilityApplied = method === "compatibility_category_location";
      if (requiredConsumedBy.has(entry.id)) {
        classified.push({
          finding,
          index,
          classification: "duplicate",
          matchedId: entry.id,
          speculative,
          matchMethod: method,
          normalizedCategory,
          compatibilityApplied,
        });
      } else {
        requiredConsumedBy.set(entry.id, index);
        classified.push({
          finding,
          index,
          classification: "matched_required",
          matchedId: entry.id,
          speculative,
          matchMethod: method,
          normalizedCategory,
          compatibilityApplied,
        });
      }
      return;
    }

    const optionalMatch = ambiguousBlocksMatch
      ? undefined
      : pickMatch(manifest.expected.optional_findings, new Set(optionalConsumedBy.keys()), finding, needsDisambiguation);
    if (optionalMatch) {
      const { entry, method } = optionalMatch;
      const compatibilityApplied = method === "compatibility_category_location";
      if (optionalConsumedBy.has(entry.id)) {
        classified.push({
          finding,
          index,
          classification: "duplicate",
          matchedId: entry.id,
          speculative,
          matchMethod: method,
          normalizedCategory,
          compatibilityApplied,
        });
      } else {
        optionalConsumedBy.set(entry.id, index);
        classified.push({
          finding,
          index,
          classification: "matched_optional",
          matchedId: entry.id,
          speculative,
          matchMethod: method,
          normalizedCategory,
          compatibilityApplied,
        });
      }
      return;
    }

    // Strict default-deny: explicit prohibited_categories, a safe/
    // false_positive_trap fixture (any finding at all is wrong), an
    // over-confident finding on an ambiguous fixture, or simply a
    // category never declared allowed for this fixture — all fall
    // through to "prohibited." Being in allowed_categories is
    // necessary but not sufficient; see unsupported_extra below.
    // Both checks are compatibility-aware (raw OR normalized category).
    const explicitlyProhibited = categoryInSet(finding.category, prohibitedCategories);
    const ambiguousOverconfidence = isAmbiguous && finding.confidence !== "low";
    const categoryAllowed = categoryInSet(finding.category, allowedCategories);
    const compatibilityApplied =
      (!prohibitedCategories.has(finding.category) && explicitlyProhibited) ||
      (!allowedCategories.has(finding.category) && categoryAllowed);

    if (explicitlyProhibited || isSafe || ambiguousOverconfidence || !categoryAllowed) {
      classified.push({
        finding,
        index,
        classification: "prohibited",
        matchedId: null,
        speculative,
        matchMethod: "unmatched",
        normalizedCategory,
        compatibilityApplied,
      });
      return;
    }

    classified.push({
      finding,
      index,
      classification: "unsupported_extra",
      matchedId: null,
      speculative,
      matchMethod: "unmatched",
      normalizedCategory,
      compatibilityApplied,
    });
  });

  const requiredFindingsDetected = manifest.expected.required_findings
    .filter((entry) => requiredConsumedBy.has(entry.id))
    .map((entry) => entry.id);
  const requiredFindingsMissed = manifest.expected.required_findings
    .filter((entry) => !requiredConsumedBy.has(entry.id))
    .map((entry) => entry.id);
  const optionalFindingsAccepted = manifest.expected.optional_findings
    .filter((entry) => optionalConsumedBy.has(entry.id))
    .map((entry) => entry.id);

  const duplicates = classified.filter((c) => c.classification === "duplicate");
  const prohibitedFindings = classified.filter((c) => c.classification === "prohibited");
  const falsePositives = classified.filter((c) => c.classification === "unsupported_extra");
  const hallucinatedPaths = classified.filter((c) => c.classification === "hallucinated_path");
  const fabricatedEvidence = classified.filter((c) => c.classification === "fabricated_evidence");
  const speculativeFindings = classified.filter(
    (c) => c.speculative && (c.classification === "matched_required" || c.classification === "matched_optional"),
  );
  const insufficientEvidenceFindings = classified.filter((c) => c.classification === "insufficient_evidence");

  const evidenceStateDiagnostics: EvidenceStateDiagnostics = { p0p1Total: 0, p0p1Measurable: 0, p0p1NotMeasurable: 0, p0p1Violations: 0 };
  for (const produced of result.findings) {
    if (produced.severity !== "P0" && produced.severity !== "P1") continue;
    evidenceStateDiagnostics.p0p1Total += 1;
    if (produced.evidenceState === undefined) evidenceStateDiagnostics.p0p1NotMeasurable += 1;
    else if (produced.evidenceState === "needs_more_context") evidenceStateDiagnostics.p0p1Violations += 1;
    else evidenceStateDiagnostics.p0p1Measurable += 1;
  }

  let severityCorrect = 0;
  let severityInflated = 0;
  let severityUnderstated = 0;
  for (const c of classified) {
    if (c.classification !== "matched_required" || c.matchedId === null) continue;
    const entry = findEntry(manifest.expected.required_findings, c.matchedId);
    const rank = SEVERITY_RANK[c.finding.severity];
    if (rank > SEVERITY_RANK[entry.severity_range[1]]) severityInflated += 1;
    else if (rank < SEVERITY_RANK[entry.severity_range[0]]) severityUnderstated += 1;
    else severityCorrect += 1;
  }

  const confidenceObservations = classified.map((c) => ({
    confidence: c.finding.confidence,
    correct:
      c.classification === "matched_required" ||
      c.classification === "matched_optional" ||
      c.classification === "duplicate",
  }));

  let p0Total = 0;
  let p0Matched = 0;
  let p1Total = 0;
  let p1Matched = 0;
  for (const entry of manifest.expected.required_findings) {
    const matched = requiredConsumedBy.has(entry.id);
    if (severityRangeIncludes(entry.severity_range, "P0")) {
      p0Total += 1;
      if (matched) p0Matched += 1;
    }
    if (severityRangeIncludes(entry.severity_range, "P1")) {
      p1Total += 1;
      if (matched) p1Matched += 1;
    }
  }

  const hardFailure = hallucinatedPaths.length > 0 || fabricatedEvidence.length > 0;

  let rawScore = 0;
  for (const entry of manifest.expected.required_findings) {
    if (requiredConsumedBy.has(entry.id)) {
      rawScore += 1;
    } else {
      rawScore -= severityRangeIncludes(entry.severity_range, "P0") ? 2 : 1;
    }
  }
  rawScore -= 0.3 * duplicates.length;
  rawScore -= (isSafe ? 2 : 1) * prohibitedFindings.length;
  rawScore -= 0.5 * falsePositives.length;
  rawScore -= 0.5 * speculativeFindings.length;
  rawScore -= 0.5 * severityInflated;
  rawScore -= 0.25 * severityUnderstated;

  // Correctly recognizing "no confident, well-evidenced vulnerability
  // exists here" is itself a scored positive for safe/ambiguous
  // fixtures — not just the absence of a penalty. Applies uniformly to
  // both archetypes rather than two separately-special-cased rules.
  const wouldPassIgnoringRequired = !hardFailure && prohibitedFindings.length === 0 && falsePositives.length === 0;
  if ((isSafe || isAmbiguous) && wouldPassIgnoringRequired) {
    rawScore += 1;
  }

  const maxPossible = manifest.expected.required_findings.length + (isSafe || isAmbiguous ? 1 : 0);
  const minPossible = -5;
  const normalizedScore = hardFailure
    ? 0
    : Math.min(1, Math.max(0, (rawScore - minPossible) / (maxPossible - minPossible)));

  const passed =
    !hardFailure &&
    requiredFindingsMissed.length === 0 &&
    prohibitedFindings.length === 0 &&
    falsePositives.length === 0;

  return {
    fixtureId: manifest.fixture_id,
    domain: manifest.domain,
    tags: manifest.tags,
    passed,
    hardFailure,
    rawScore,
    normalizedScore,
    requiredFindingsDetected,
    requiredFindingsMissed,
    optionalFindingsAccepted,
    falsePositives,
    prohibitedFindings,
    duplicates,
    hallucinatedPaths,
    fabricatedEvidence,
    speculativeFindings,
    insufficientEvidenceFindings,
    evidenceStateDiagnostics,
    allFindings: classified,
    severityAccuracy: { correct: severityCorrect, inflated: severityInflated, understated: severityUnderstated },
    confidenceObservations,
    requiredSeverityBreakdown: { p0Total, p0Matched, p1Total, p1Matched },
  };
}

// ---------------------------------------------------------------------------
// Compatibility report (plan §5) — diagnosing a scored run
// ---------------------------------------------------------------------------

export interface CompatibilityReportRow {
  index: number;
  file: string | null;
  originalCategory: string;
  normalizedCategory: string | undefined;
  classification: FindingClassification;
  matchedId: string | null;
  matchMethod: MatchMethod;
  compatibilityApplied: boolean;
  /** Task 1 — `undefined` when the producer didn't supply one (today's unmodified production output; see `evidenceStateDiagnostics` for the P0/P1-scoped "not measurable" count this feeds). */
  evidenceState: EvidenceState | undefined;
}

/**
 * Flattens a `FixtureScore`'s `allFindings` into a report row per
 * produced finding — original category, normalized category (if any),
 * how (if at all) it matched, and whether the compatibility layer
 * changed the outcome. Meant to make a benchmark failure diagnosable
 * at a glance ("was this a real miss, or just a category-labeling
 * mismatch the compatibility layer should have bridged but didn't?")
 * without digging through `FixtureScore`'s separate classification
 * buckets by hand.
 */
export function buildCompatibilityReport(score: FixtureScore): CompatibilityReportRow[] {
  return score.allFindings.map((c) => ({
    index: c.index,
    file: c.finding.file,
    originalCategory: c.finding.category,
    normalizedCategory: c.normalizedCategory,
    classification: c.classification,
    matchedId: c.matchedId,
    matchMethod: c.matchMethod,
    compatibilityApplied: c.compatibilityApplied,
    evidenceState: c.finding.evidenceState,
  }));
}

// ---------------------------------------------------------------------------
// Suite-level aggregate metrics
// ---------------------------------------------------------------------------

export interface SuiteMetrics {
  fixturesRun: number;
  fixturesPassed: number;
  fixturesFailed: number;
  totalProducedFindings: number;
  classificationCounts: Record<FindingClassification, number>;
  precision: number;
  recall: number;
  p0Recall: number;
  p1Recall: number;
  falsePositiveRate: number;
  hallucinationRate: number;
  speculativeRate: number;
  duplicateRate: number;
  severityAccuracyRate: number;
  confidenceCalibration: Record<Confidence, { total: number; correct: number; rate: number }>;
  byDomain: Record<string, number>;
  byTag: Record<string, number>;
  failedFixtures: string[];
  /** Task 5, suite-wide — sum of every fixture's `evidenceStateDiagnostics`, plus a coverage rate (`p0p1Measurable / p0p1Total`, reported as `1` when `p0p1Total` is `0` — vacuously nothing to measure, not a violation). */
  evidenceState: EvidenceStateDiagnostics & { coverageRate: number };
}

/** `den === 0` means "nothing to measure" — reported as `whenZero` rather than NaN/Infinity. */
function safeDivide(numerator: number, denominator: number, whenZero: number): number {
  return denominator === 0 ? whenZero : numerator / denominator;
}

export function aggregateScores(scores: FixtureScore[]): SuiteMetrics {
  let totalRequiredMatched = 0;
  let totalRequired = 0;
  let totalOptionalMatched = 0;
  let p0Total = 0;
  let p0Matched = 0;
  let p1Total = 0;
  let p1Matched = 0;
  let totalDuplicates = 0;
  let totalProhibited = 0;
  let totalUnsupported = 0;
  let totalHallucinated = 0;
  let totalFabricated = 0;
  let totalSpeculative = 0;
  let totalInsufficientEvidence = 0;
  const evidenceState: EvidenceStateDiagnostics = { p0p1Total: 0, p0p1Measurable: 0, p0p1NotMeasurable: 0, p0p1Violations: 0 };
  let severityCorrect = 0;
  let severityChecked = 0;
  const confidenceBuckets: Record<Confidence, { total: number; correct: number }> = {
    high: { total: 0, correct: 0 },
    medium: { total: 0, correct: 0 },
    low: { total: 0, correct: 0 },
  };
  const byDomainScores: Record<string, number[]> = {};
  const byTagScores: Record<string, number[]> = {};
  const failedFixtures: string[] = [];

  for (const s of scores) {
    totalRequiredMatched += s.requiredFindingsDetected.length;
    totalRequired += s.requiredFindingsDetected.length + s.requiredFindingsMissed.length;
    totalOptionalMatched += s.optionalFindingsAccepted.length;
    p0Total += s.requiredSeverityBreakdown.p0Total;
    p0Matched += s.requiredSeverityBreakdown.p0Matched;
    p1Total += s.requiredSeverityBreakdown.p1Total;
    p1Matched += s.requiredSeverityBreakdown.p1Matched;
    totalDuplicates += s.duplicates.length;
    totalProhibited += s.prohibitedFindings.length;
    totalUnsupported += s.falsePositives.length;
    totalHallucinated += s.hallucinatedPaths.length;
    totalFabricated += s.fabricatedEvidence.length;
    totalSpeculative += s.speculativeFindings.length;
    totalInsufficientEvidence += s.insufficientEvidenceFindings.length;
    evidenceState.p0p1Total += s.evidenceStateDiagnostics.p0p1Total;
    evidenceState.p0p1Measurable += s.evidenceStateDiagnostics.p0p1Measurable;
    evidenceState.p0p1NotMeasurable += s.evidenceStateDiagnostics.p0p1NotMeasurable;
    evidenceState.p0p1Violations += s.evidenceStateDiagnostics.p0p1Violations;
    severityCorrect += s.severityAccuracy.correct;
    severityChecked += s.severityAccuracy.correct + s.severityAccuracy.inflated + s.severityAccuracy.understated;

    for (const obs of s.confidenceObservations) {
      confidenceBuckets[obs.confidence].total += 1;
      if (obs.correct) confidenceBuckets[obs.confidence].correct += 1;
    }

    (byDomainScores[s.domain] ??= []).push(s.normalizedScore);
    for (const tag of s.tags) {
      (byTagScores[tag] ??= []).push(s.normalizedScore);
    }
    if (s.hardFailure) failedFixtures.push(s.fixtureId);
  }

  const totalMatched = totalRequiredMatched + totalOptionalMatched;
  const totalProducedFindings =
    totalMatched +
    totalDuplicates +
    totalProhibited +
    totalUnsupported +
    totalHallucinated +
    totalFabricated +
    totalInsufficientEvidence;

  const average = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;

  return {
    fixturesRun: scores.length,
    fixturesPassed: scores.filter((s) => s.passed).length,
    fixturesFailed: scores.filter((s) => s.hardFailure).length,
    totalProducedFindings,
    classificationCounts: {
      matched_required: totalRequiredMatched,
      matched_optional: totalOptionalMatched,
      duplicate: totalDuplicates,
      prohibited: totalProhibited,
      unsupported_extra: totalUnsupported,
      hallucinated_path: totalHallucinated,
      fabricated_evidence: totalFabricated,
      insufficient_evidence: totalInsufficientEvidence,
    },
    precision: safeDivide(totalMatched, totalProducedFindings, 1),
    recall: safeDivide(totalRequiredMatched, totalRequired, 1),
    p0Recall: safeDivide(p0Matched, p0Total, 1),
    p1Recall: safeDivide(p1Matched, p1Total, 1),
    falsePositiveRate: safeDivide(totalProhibited + totalUnsupported, totalProducedFindings, 0),
    hallucinationRate: safeDivide(totalHallucinated, totalProducedFindings, 0),
    speculativeRate: safeDivide(totalSpeculative, totalProducedFindings, 0),
    duplicateRate: safeDivide(totalDuplicates, totalProducedFindings, 0),
    severityAccuracyRate: safeDivide(severityCorrect, severityChecked, 1),
    confidenceCalibration: {
      high: { ...confidenceBuckets.high, rate: safeDivide(confidenceBuckets.high.correct, confidenceBuckets.high.total, 1) },
      medium: {
        ...confidenceBuckets.medium,
        rate: safeDivide(confidenceBuckets.medium.correct, confidenceBuckets.medium.total, 1),
      },
      low: { ...confidenceBuckets.low, rate: safeDivide(confidenceBuckets.low.correct, confidenceBuckets.low.total, 1) },
    },
    byDomain: Object.fromEntries(Object.entries(byDomainScores).map(([domain, values]) => [domain, average(values)])),
    byTag: Object.fromEntries(Object.entries(byTagScores).map(([tag, values]) => [tag, average(values)])),
    failedFixtures,
    evidenceState: { ...evidenceState, coverageRate: safeDivide(evidenceState.p0p1Measurable, evidenceState.p0p1Total, 1) },
  };
}

// Re-exported so callers of this module don't also need to import from
// "./schema" just to build CONFIDENCE_RANK-ordered test fixtures.
export { CONFIDENCE_RANK, SEVERITY_RANK };
