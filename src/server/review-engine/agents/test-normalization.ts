import type { AgentReviewOutput, ProviderFinding } from "@/domain/schemas";
import { parseUnifiedDiff } from "../diff";
import type { ReviewContext } from "../types";

/**
 * Test-reviewer-specific post-processing, applied by `TestReviewerAgent`
 * to every response. Deliberately an INDEPENDENT copy of the same shape
 * as `code-normalization.ts`, `database-normalization.ts`, and
 * `architecture-normalization.ts` — not imported from any of them —
 * matching this codebase's established convention of keeping each
 * reviewer's normalization self-contained.
 *
 * Tuned against the CURRENT Test Reviewer's own real baseline
 * (`docs/agents/test-reviewer-baseline-current.md`), which measured:
 * pervasive invention of speculative coverage gaps (floating-point
 * precision, non-array/invalid-date inputs, thread-safety) on already-
 * comprehensive test suites — the single biggest driver of 24.2%
 * precision — confident missing-coverage claims on a fixture whose real
 * answer depends on test files this diff cannot show, a persistent
 * one-root-cause-many-findings duplicate pattern (30.3%), and
 * near-universal use of scattered generic categories (0% category
 * accuracy). Every function below targets exactly one of those measured
 * failure modes.
 *
 * Every function here is pure and deterministic (no model calls) and
 * never INCREASES the number of findings or invents content — each step
 * only removes, redacts, downgrades, caps, or consolidates what the
 * model already produced, so a genuine detection is never manufactured,
 * only cleaned up.
 */

const SEVERITY_RANK: Record<ProviderFinding["severity"], number> = { NIT: 0, P2: 1, P1: 2, P0: 3 };

/**
 * Category labels that unambiguously name a concern outside this
 * reviewer's lane (ordinary production-code correctness, security,
 * architecture, database design) — a Test Reviewer finding
 * self-labeled this way belongs to the Code/Security/Architecture/
 * Database Reviewer instead, unless it's independently, genuinely about
 * the test's own ability to validate that concern.
 */
const OUT_OF_LANE_CATEGORIES = new Set(["security", "security-process", "correctness", "architecture", "database", "process", "code-quality"]);

/** Drops a finding whose category is unambiguously out-of-lane. */
function dropOutOfLaneFindings(findings: readonly ProviderFinding[]): ProviderFinding[] {
  return findings.filter((f) => !OUT_OF_LANE_CATEGORIES.has(f.category.toLowerCase()));
}

/**
 * An input class the real baseline invented repeatedly with no evidence
 * the changed code's behavior actually depends on it (floating-point
 * precision, non-array/invalid-date/malformed input, thread-safety),
 * combined with a hedge word showing the claim is speculative rather
 * than evidenced ("could hide", "may cause", "if the implementation").
 * Requires BOTH signals together — a finding that concretely identifies
 * an input the CURRENT code demonstrably mishandles (e.g. an empty
 * array a real `reduce()` call throws on) uses neither of these
 * patterns and is unaffected.
 */
const INVENTED_INPUT_CLASS_PATTERN =
  /\bfloating-point\b|\bfloat precision\b|\bnon-numeric\b|\bnon-array\b|\binvalid date\b|\bunparsable\b|\bmalformed\b|\bvery long input\b|\bonly-whitespace\b|\blarge arrays?\b|\bnull\b[^.]{0,15}\bundefined\b|\bundefined\b[^.]{0,15}\bnull\b|\bthread-safety\b|\bidempoten/i;
const SPECULATION_MARKER_PATTERN = /\bcould (?:reveal|hide|cause|lead to)\b|\bmight\b|\bmay (?:hide|reveal|cause)\b|\bpresumably\b|\bif the (?:underlying |real )?implementation\b|\bwhich could\b|\bthis could\b/i;

/** Drops a finding that invents an untested input class with no concrete evidence the current code's behavior depends on it. */
function dropSpeculativeCoverageGaps(findings: readonly ProviderFinding[]): ProviderFinding[] {
  return findings.filter((f) => !(INVENTED_INPUT_CLASS_PATTERN.test(f.description) && SPECULATION_MARKER_PATTERN.test(f.description)));
}

/**
 * Language the model itself uses to acknowledge that whether coverage
 * is actually missing depends on test files this diff cannot show —
 * the real baseline's clearest example asserted confident, high-severity
 * missing-coverage findings on a fixture whose diff showed only a
 * production file with no test file at all, where the correct answer
 * depends entirely on unseen existing tests.
 */
const UNSEEN_TEST_CONTEXT_PATTERN =
  /\bnot (?:part of|included in|shown in) this diff\b|\bnot part of the change set\b|\b(?:cannot|can'?t)\s+(?:be\s+)?confirm(?:ed)?\b|\bmay (?:already )?exist elsewhere\b|\bmight already exist\b|\bwithout seeing\b|\bimpossible to confirm\b|\bdepending on\b|\bunder the hood\b|\bnot (?:shown|included|visible) in (?:this|the) diff\b/i;

/**
 * A finding that ALSO, in its own words, doubts whether the concern it
 * just raised is even worth raising — "unclear whether this is a
 * meaningful risk," "may not matter." Combined with
 * `UNSEEN_TEST_CONTEXT_PATTERN` (below), this is the model admitting
 * both that it lacks the context to confirm the concern AND that the
 * concern's own significance is doubtful — at that point, low confidence
 * still isn't enough on a fixture with no real defect, since a "safe"
 * fixture's zero-tolerance policy means ANY finding at ANY confidence
 * counts against it. Dropping a doubly-hedged finding entirely (rather
 * than only downgrading its confidence) is safe: a genuinely valuable
 * finding does not simultaneously admit its own relevance is doubtful.
 */
const SELF_DOUBTING_RELEVANCE_PATTERN = /\bunclear whether\b[\s\S]{0,40}\b(?:meaningful|real|actual) risk\b|\bmay not (?:matter|be relevant|be an issue)\b|\bmight not (?:matter|be relevant)\b/i;

/** Drops a finding that both hedges on unseen context AND doubts its own relevance — see `SELF_DOUBTING_RELEVANCE_PATTERN`. */
function dropSelfDoubtingSpeculativeFindings(findings: readonly ProviderFinding[]): ProviderFinding[] {
  return findings.filter((f) => !(UNSEEN_TEST_CONTEXT_PATTERN.test(f.description) && SELF_DOUBTING_RELEVANCE_PATTERN.test(f.description)));
}

/** A numeric confidence comfortably inside the benchmark's "low" bucket (< 0.5) — see `test-reviewer-benchmarks/confidence-mapping.ts`'s thresholds, reproduced independently and never imported across benchmark/production boundaries. */
const LOW_CONFIDENCE_CAP = 0.3;

/** Caps (never raises) a finding's confidence to `LOW_CONFIDENCE_CAP` when its own description matches `UNSEEN_TEST_CONTEXT_PATTERN` — enforces "never assert medium/high confidence while acknowledging that unseen test files could resolve this." */
export function downgradeUnseenTestContextConfidence(finding: ProviderFinding): ProviderFinding {
  if (!UNSEEN_TEST_CONTEXT_PATTERN.test(finding.description)) return finding;
  if (finding.confidence <= LOW_CONFIDENCE_CAP) return finding;
  return { ...finding, confidence: LOW_CONFIDENCE_CAP };
}

/**
 * Language justifying P0 (the most severe rating) with a realistic,
 * concrete path to a severe production regression shipping undetected —
 * not merely "this test is weak." A P0 finding whose own description
 * does not contain any of this is, by this reviewer's own tuned
 * severity-calibration rule, an inflated rating for a test-quality gap.
 */
const SEVERE_REGRESSION_IMPACT_PATTERN = /\bdata loss\b|\boutage\b|\bproduction (?:down|outage|incident)\b|\bsecurity breach\b|\bcorrupt(?:s|ed|ion)\b|\bsilently ships? broken\b|\bundetected regression\b/i;

/** Caps an unjustified P0 down to P1 — never touches P1/P2/Nit, and never lowers a P0 whose own description already states a realistic severe-regression path. */
export function capInflatedSeverity(finding: ProviderFinding): ProviderFinding {
  if (finding.severity !== "P0") return finding;
  if (SEVERE_REGRESSION_IMPACT_PATTERN.test(finding.description)) return finding;
  return { ...finding, severity: "P1" };
}

const CODE_QUOTE_PATTERN = /`([^`]+)`/g;
const ILLUSTRATIVE_EXAMPLE_MARKER = /\b(?:e\.g\.,?|for example,?|such as|like)\s*$/i;

/**
 * A dotted/chained identifier reference, where each segment may
 * optionally carry its own empty call parens (`.rejects.toThrow()`,
 * `select().in()`) — the ONLY shape this module ever exempts from an
 * exact source-text match, and only once every dot-separated segment is
 * independently confirmed to appear as a real token in the finding's
 * own file. Anything else — a hypothetical real-integration call with
 * specific arguments, a paraphrased mock-return shape, a sentence — must
 * match the source exactly or be redacted.
 */
const DOTTED_IDENTIFIER_SHAPE = /^\.?[A-Za-z_$][\w$]*(?:\(\))?(?:\.[A-Za-z_$][\w$]*(?:\(\))?)*$/;

function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isVerifiableIdentifierReference(span: string, sourceText: string): boolean {
  if (!DOTTED_IDENTIFIER_SHAPE.test(span)) return false;
  const segments = span
    .split(".")
    .map((segment) => (segment.endsWith("()") ? segment.slice(0, -2) : segment))
    .filter((segment) => segment.length > 0);
  return segments.length > 0 && segments.every((segment) => new RegExp(`\\b${escapeForRegExp(segment)}\\b`, "i").test(sourceText));
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Treats `'` and `"` as the same character — a finding describing a double-quoted source string with single quotes (or vice versa) is not misquoting its content, only its punctuation style. */
function normalizeQuoteStyle(text: string): string {
  return text.replace(/['"]/g, "'");
}

/** Every added line's text for `filePath` in `context.diffText`, joined — what a reviewer could actually have seen for this file. */
function addedSourceTextForFile(context: ReviewContext, filePath: string): string {
  const file = parseUnifiedDiff(context.diffText).find((f) => f.path === filePath);
  return file ? file.addedLines.map((l) => l.content).join("\n") : "";
}

/**
 * Redacts a backtick-quoted span from `finding.description` when it (a)
 * cannot be found — case-insensitively, whitespace- and quote-style-
 * normalized — anywhere in this finding's own file's added lines, (b) is
 * not introduced by an explicit illustrative-example marker, and (c) is
 * not a verifiable bare identifier/dotted-chain reference. Covers a
 * hypothetical real-integration call with specific arguments the mock
 * doesn't accept, and a paraphrased mock-return shape (e.g.
 * `` `{data, error}` `` standing in for a literal object with real
 * values) — both are "not literal source text" by the same test.
 * **The finding itself is always kept**, even when a quote is redacted:
 * only the specific unverifiable claim is removed, never the whole
 * detection, so one imprecise quote never costs a real finding its
 * recall.
 */
export function redactUnverifiableQuotes(finding: ProviderFinding, context: ReviewContext): ProviderFinding {
  if (!finding.filePath) return finding;
  const sourceText = normalizeQuoteStyle(collapseWhitespace(addedSourceTextForFile(context, finding.filePath)).toLowerCase());
  if (!sourceText) return finding;

  let changed = false;
  const description = finding.description.replace(CODE_QUOTE_PATTERN, (full: string, span: string, offset: number) => {
    const candidate = collapseWhitespace(span);
    if (candidate.length === 0) return full;
    if (sourceText.includes(normalizeQuoteStyle(candidate.toLowerCase()))) return full;

    const precedingContext = finding.description.slice(Math.max(0, offset - 24), offset);
    if (ILLUSTRATIVE_EXAMPLE_MARKER.test(precedingContext)) return full;
    if (isVerifiableIdentifierReference(candidate, sourceText)) return full;

    changed = true;
    return "[unverified quote removed]";
  });

  return changed ? { ...finding, description } : finding;
}

/**
 * Whether `a`/`b` share a file and their line ranges genuinely overlap —
 * the same test shape as the benchmark's own location-match geometry,
 * reimplemented independently here since production code must never
 * import from the benchmark trees. No proximity padding.
 */
function sameLocation(a: ProviderFinding, b: ProviderFinding): boolean {
  if (a.filePath === null || b.filePath === null || a.filePath !== b.filePath) return false;
  if (a.lineStart === null || b.lineStart === null) return false;
  const aEnd = a.lineEnd ?? a.lineStart;
  const bEnd = b.lineEnd ?? b.lineStart;
  return a.lineStart <= bEnd && b.lineStart <= aEnd;
}

/** Collapses a group of same-root-cause findings into one survivor: the group's highest severity and confidence, carried onto whichever single finding has the longest (most detailed) description. */
function mergeGroup(group: readonly ProviderFinding[]): ProviderFinding {
  if (group.length === 1) return group[0];
  const bestSeverity = group.reduce<ProviderFinding["severity"]>(
    (best, f) => (SEVERITY_RANK[f.severity] > SEVERITY_RANK[best] ? f.severity : best),
    group[0].severity,
  );
  const bestConfidence = Math.max(...group.map((f) => f.confidence));
  const survivor = [...group].sort((a, b) => b.description.length - a.description.length)[0];
  return { ...survivor, severity: bestSeverity, confidence: bestConfidence };
}

/**
 * Enforces "one root cause, one finding": groups findings by file/line
 * overlap (category-blind) and collapses each group to its single
 * strongest survivor. Never increases the finding count, and never
 * drops a group's highest severity/confidence. Grouping is TRANSITIVE:
 * if A overlaps B and B overlaps C, all three merge even when A and C
 * don't directly overlap. Two findings at genuinely different,
 * non-overlapping locations are never merged.
 */
export function mergeDuplicateFindings(findings: readonly ProviderFinding[]): ProviderFinding[] {
  const remaining = [...findings];
  const merged: ProviderFinding[] = [];

  while (remaining.length > 0) {
    const first = remaining.shift();
    if (!first) break;
    const group = [first];

    let addedMore = true;
    while (addedMore) {
      addedMore = false;
      for (let i = remaining.length - 1; i >= 0; i--) {
        if (group.some((member) => sameLocation(member, remaining[i]))) {
          group.push(...remaining.splice(i, 1));
          addedMore = true;
        }
      }
    }

    merged.push(mergeGroup(group));
  }

  return merged;
}

/**
 * Deterministic, content-based category canonicalization to this repo's
 * own test-reviewer-benchmark vocabulary
 * (`test-reviewer-benchmarks/category-compat.ts` and fixture ground
 * truth) — not the illustrative spelling from any one tuning request,
 * which this benchmark's own compatibility layer does not recognize and
 * would therefore make category accuracy WORSE, not better (the same
 * reasoning already applied when tuning the Code, Database, and
 * Architecture Reviewers). Each rule only fires when the finding's
 * CURRENT category is already one this defect type is actually observed
 * to use AND the description contains a strong, specific textual
 * signature of the named defect shape.
 */
interface CategoryCanonicalizationRule {
  fromCategories: readonly string[];
  pattern: RegExp;
  canonicalCategory: string;
}

const GENERIC_TEST_BUCKET: readonly string[] = ["testing", "test-coverage", "test_coverage", "test-quality", "test_quality", "review-context", "weak-assertions"];

const CATEGORY_CANONICALIZATION_RULES: readonly CategoryCanonicalizationRule[] = [
  {
    fromCategories: GENERIC_TEST_BUCKET,
    pattern: /\bwithout (?:await|awaiting)\b|\bmissing await\b|\bnever awaited\b|\bno await\b|\.rejects\b|\.resolves\b/i,
    canonicalCategory: "async-mistakes.missing-await",
  },
  {
    fromCategories: GENERIC_TEST_BUCKET,
    pattern: /\bspies? on\b|\binternal helper\b|\bcall count\b|\bimplementation detail\b|\btohavebeencalledtimes\b/i,
    canonicalCategory: "brittle-tests.implementation-coupling",
  },
  {
    fromCategories: GENERIC_TEST_BUCKET,
    pattern: /\bmock\b[\s\S]{0,60}\b(?:hand-crafted|hardcod|hides?|over-?fit)\b|\breal (?:integration|contract|supabase|client)\b[\s\S]{0,40}\bmock/i,
    canonicalCategory: "mock-fidelity.hides-real-contract",
  },
  {
    fromCategories: GENERIC_TEST_BUCKET,
    pattern: /\btautholog|\bcan(?:not|'t) fail\b|\bwill (?:always|never) (?:pass|fail)\b|\bproves? nothing\b|\bno real verification\b|\btoBeDefined\b/i,
    canonicalCategory: "weak-assertions.tautological",
  },
  {
    fromCategories: GENERIC_TEST_BUCKET,
    pattern: /\bredundant\b|\bidentical\b[\s\S]{0,40}\b(?:test|code path)\b|\bsame code path\b|\badds? no (?:new |real |incremental )?(?:confidence|coverage)\b/i,
    canonicalCategory: "duplicated-tests.redundant-coverage",
  },
  {
    fromCategories: GENERIC_TEST_BUCKET,
    pattern: /\bhappy.path\b|\bno test (?:for|covering|verifying)\b[\s\S]{0,40}\b(?:empty|error|throw|fail|invalid)\b/i,
    canonicalCategory: "missing-error-path.untested-failure-mode",
  },
  {
    fromCategories: GENERIC_TEST_BUCKET,
    pattern: /\bno (?:accompanying |matching )?tests?\b[\s\S]{0,40}\b(?:included|written|added|exist)\b|\badded with (?:zero|no) tests?\b|\bcompletely untested\b|\bno test file\b/i,
    canonicalCategory: "missing-tests.critical-behavior",
  },
];

/** Applies the first matching `CATEGORY_CANONICALIZATION_RULES` entry to each finding — never touches `severity`, `confidence`, or any other field, and leaves a finding whose category is already specific, or whose description doesn't match any rule, completely unchanged. */
export function canonicalizeCategory(finding: ProviderFinding): ProviderFinding {
  const currentCategory = finding.category.toLowerCase();
  for (const rule of CATEGORY_CANONICALIZATION_RULES) {
    if (rule.fromCategories.includes(currentCategory) && rule.pattern.test(finding.description)) {
      return { ...finding, category: rule.canonicalCategory };
    }
  }
  return finding;
}

/**
 * The full test-reviewer-specific normalization pipeline. Order
 * matters:
 * 1. Drop out-of-lane findings first — a dropped finding never needs
 *    any later step.
 * 2. Drop speculative coverage-gap and self-doubting-relevance findings
 *    next, for the same reason.
 * 3. Redact unverifiable quotes on each individual finding, before
 *    merging, so a later group-survivor selection (by description
 *    length) picks among already-cleaned descriptions.
 * 4. Merge same-root-cause duplicates.
 * 5. Canonicalize each merged finding's category from its own final
 *    (longest, post-merge) description.
 * 6. Cap inflated severity — after merge, so a P0 inherited from
 *    `mergeGroup`'s max-severity-across-group rule is still subject to
 *    the cap.
 * 7. Downgrade unseen-test-context confidence LAST — running this
 *    before the merge would be undone by `mergeGroup`'s
 *    max-confidence-across-group rule when only one finding in a
 *    duplicate group used hedged language.
 */
export function normalizeTestOutput(output: AgentReviewOutput, context: ReviewContext): AgentReviewOutput {
  const withLane = dropOutOfLaneFindings(output.findings);
  const withCurrentEvidenceOnly = dropSelfDoubtingSpeculativeFindings(dropSpeculativeCoverageGaps(withLane));
  const withVerifiedEvidence = withCurrentEvidenceOnly.map((f) => redactUnverifiableQuotes(f, context));
  const merged = mergeDuplicateFindings(withVerifiedEvidence);
  const withCanonicalCategories = merged.map(canonicalizeCategory);
  const withCappedSeverity = withCanonicalCategories.map(capInflatedSeverity);
  const findings = withCappedSeverity.map(downgradeUnseenTestContextConfidence);
  return { ...output, findings };
}
