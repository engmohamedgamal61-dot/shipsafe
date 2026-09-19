import type { AgentReviewOutput, ProviderFinding } from "@/domain/schemas";
import { parseUnifiedDiff } from "../diff";
import type { ReviewContext } from "../types";

/**
 * Code-reviewer-specific post-processing, applied by `CodeReviewerAgent`
 * to every response. Deliberately an INDEPENDENT copy of the same shape
 * as `security-normalization.ts` — not imported from it — matching this
 * codebase's established convention of keeping each reviewer's
 * normalization self-contained (see `security-normalization.ts`'s own
 * doc comment, and `tests/code-benchmarks/README.md`'s rationale for why
 * the two benchmarks stay independent too).
 *
 * Tuned across two real-baseline passes against
 * `docs/agents/code-baseline-current.md`. The first pass fixed: two hard
 * failures caused by an otherwise-correct finding quoting a computed
 * value or an ellipsis-abbreviated call inside backticks, a persistent
 * one-root-cause-many-findings duplicate pattern (25% duplicate rate), a
 * confident finding escalating an unconfirmed dependency's behavior
 * (100% ambiguous-overclaim rate), and a finding invented from a
 * hypothetical future code change rather than the code's current,
 * demonstrated behavior. A second, narrower pass (after precision/recall
 * reached 80%/100%) added: dropping a finding that admits a switch is
 * statically exhaustive yet still speculates about an unevidenced
 * external input reaching it, dropping a finding that frames
 * `Array.prototype.slice`'s own documented negative-index behavior as a
 * defect, and canonicalizing generic categories (`correctness`,
 * `performance`, ...) to the specific label the finding's own wording
 * already supports (`correctness.off-by-one`,
 * `performance.algorithmic-complexity`, ...). Every function below
 * targets exactly one of those measured failure modes.
 *
 * Every function here is pure and deterministic (no model calls) and
 * never INCREASES the number of findings or invents content — each step
 * only removes, redacts, downgrades, or consolidates what the model
 * already produced, so a genuine detection is never manufactured, only
 * cleaned up.
 */

const SEVERITY_RANK: Record<ProviderFinding["severity"], number> = { NIT: 0, P2: 1, P1: 2, P0: 3 };

/**
 * Category labels that name a security concern rather than one of this
 * reviewer's own lanes (correctness, maintainability, performance,
 * error-handling, API misuse, concurrency, code quality) — the Security
 * Reviewer already covers this ground with its own evidence/ambiguity
 * discipline, so a Code Reviewer finding self-labeled this way is out of
 * lane regardless of how accurate it might be. Deliberately a SMALL,
 * explicit deny-list of unambiguously-security terms, not a broad
 * allow-list — a reasonable code-quality category is never rejected just
 * for not matching a fixed vocabulary.
 */
const SECURITY_CATEGORIES = new Set([
  "security",
  "vulnerability",
  "injection",
  "sql-injection",
  "xss",
  "ssrf",
  "csrf",
  "secrets-management",
  "authentication",
  "authorization",
  "access-control",
  "tenant-isolation",
  "webhook-security",
]);

/** Drops a finding whose category is one of `SECURITY_CATEGORIES`. */
export function dropSecurityCategories(findings: readonly ProviderFinding[]): ProviderFinding[] {
  return findings.filter((f) => !SECURITY_CATEGORIES.has(f.category.toLowerCase()));
}

/**
 * Language that describes the code potentially breaking after a FUTURE
 * source-code EDIT elsewhere — a new enum/union member added later, a
 * schema extended, a maintainer forgetting to update this exact call
 * site after that other edit — rather than a defect the CURRENT code
 * actually demonstrates. Deliberately narrow and compound (each
 * alternative requires the specific "type/union/schema evolves AND this
 * code isn't updated to match" shape, not a bare keyword): a lone
 * mention of "future" or "in the future" is NOT enough to trigger this,
 * because that language also shows up in entirely legitimate,
 * current-code observations — e.g. "this duplication increases the risk
 * that a future change to one branch isn't applied to the others" is a
 * real, present-tense argument about why the CURRENT duplication is bad,
 * not a claim that depends on some future edit actually happening. This
 * pattern must never cost a real finding its recall just because it
 * discusses maintenance cost in passing.
 */
const HYPOTHETICAL_FUTURE_EVOLUTION_PATTERN =
  /\bif (?:this|the|a) (?:union|enum|type|interface|schema) (?:is|gets) (?:extended|changed|updated|modified)\b|\bwere to (?:change|be added|be extended|be modified)\b|\bnew\s+\w+(?:\s+\w+){0,2}\s+(?:is|are|gets?)\s+added\b[^.]{0,80}\bwithout updating\b|\bwithout updating (?:this|the) (?:switch|check|function|logic|mapping|handler|call site)\b/i;

/**
 * Drops findings whose description is built on `HYPOTHETICAL_FUTURE_EVOLUTION_PATTERN`
 * language — the finding is never rewritten or downgraded, since the
 * premise ("this will misbehave once the source changes in a specific
 * future way") isn't a claim about the diff in front of the reviewer at
 * all.
 */
export function dropHypotheticalFutureConcerns(findings: readonly ProviderFinding[]): ProviderFinding[] {
  return findings.filter((f) => !HYPOTHETICAL_FUTURE_EVOLUTION_PATTERN.test(f.description));
}

/**
 * A finding admitting the switch/conditional it targets is statically
 * EXHAUSTIVE over a closed union/enum (TypeScript's own checker accepts
 * it with no default), combined with purely speculative reachability
 * language ("if this were ever called with...", "from an untyped/JS
 * source", "a type assertion", "an unvalidated API response") rather
 * than a concrete call site shown in the same diff. Requires BOTH
 * signals together — a finding that merely mentions a type assertion or
 * external data in some other, unrelated context is not affected.
 */
const EXHAUSTIVE_SWITCH_ADMISSION_PATTERN =
  /\bexhaustive(?:ness)?\b|\ball union members are enumerated\b|\bcovers? all(?: (?:current|possible))? (?:values|members|cases)\b|\btypescript'?s? (?:control-flow analysis|type checker|exhaustiveness checking)\b/i;
const SPECULATIVE_UNREACHABLE_INPUT_PATTERN =
  /\bif (?:this|the) function (?:is|were) (?:ever )?(?:called|invoked) with\b|\buntyped(?:\/| or )?(?:js|external)\b|\ba type assertion\b|\ban? (?:unvalidated )?api response\b|\bparsed json\b|\ba database field\b|\bnot (?:strictly |fully )?(?:conform|validated against the type)\b/i;

/**
 * Drops a finding that admits a switch/conditional is statically
 * exhaustive over the current type AND whose only concern is a
 * speculative, unevidenced runtime value from outside that type system —
 * the finding's own wording concedes there is no current defect, only a
 * hypothetical one contingent on a call site the diff never shows.
 */
export function dropUnreachableExhaustiveSwitchConcerns(findings: readonly ProviderFinding[]): ProviderFinding[] {
  return findings.filter((f) => !(EXHAUSTIVE_SWITCH_ADMISSION_PATTERN.test(f.description) && SPECULATIVE_UNREACHABLE_INPUT_PATTERN.test(f.description)));
}

/**
 * A finding framing `Array.prototype.slice`'s own long-documented
 * negative-index behavior (counting from the end of the array) as
 * "inconsistent"/"unexpected" on a function that transparently delegates
 * to it — the standard-library behavior itself is not evidence the
 * wrapper is broken unless the wrapper's own contract promises different
 * semantics, which this pattern does not attempt to verify (it only
 * fires on the one concretely observed, narrow shape: a `.slice(`
 * delegate plus explicit negative-index framing plus a "this is a
 * defect" characterization, all three together) — deliberately narrow so
 * it never touches an unrelated stdlib-based finding like a missing
 * `reduce()` initial value, which IS a real crash risk on a current,
 * ordinary input and must still be reported.
 */
const DELEGATES_TO_SLICE_PATTERN = /\bslice\(|\barray\.prototype\.slice\b/i;
const NEGATIVE_INDEX_MENTION_PATTERN = /\bnegative\b[^.]{0,60}\b(?:index(?:es)?|indices|start(?:index)?)\b|\b(?:index(?:es)?|indices|start(?:index)?)\b[^.]{0,60}\bnegative\b/i;
const FRAMED_AS_DEFECT_PATTERN = /\binconsistent\b|\bunexpected\b|\bsurpris(?:e|ing)\b|\bsilently different\b|\bunintended\b/i;

export function dropStandardSliceNegativeIndexConcerns(findings: readonly ProviderFinding[]): ProviderFinding[] {
  return findings.filter(
    (f) => !(DELEGATES_TO_SLICE_PATTERN.test(f.description) && NEGATIVE_INDEX_MENTION_PATTERN.test(f.description) && FRAMED_AS_DEFECT_PATTERN.test(f.description)),
  );
}

/**
 * Language the model itself uses to acknowledge that a claim depends on
 * behavior it cannot see (an unincluded dependency's contract, "under
 * the hood" implementation, one of several possible outcomes) — the
 * signature of an ambiguous, context-dependent observation rather than a
 * confirmed defect.
 */
const ACKNOWLEDGED_UNCERTAINTY_PATTERN =
  /\bdepending on\b|\bunder the hood\b|\bit'?s unclear\b|\bnot clear (?:from|whether)\b|\bmay or may not\b|\b(?:cannot|can'?t|unable to)\s+(?:be\s+)?(?:confirm(?:ed)?|verif(?:y|ied)|be sure|determin(?:e|ed))\b|\bunknown (?:behavior|implementation|contract)\b|\bwithout (?:seeing|knowing) (?:the|its|the actual)\b|\bnot (?:shown|included|visible) in (?:this|the) diff\b|\bmay (?:return|throw|behave|produce|resolve)\b[^.]{0,60}\bor\b/i;

/** A numeric confidence comfortably inside the benchmark's "low" bucket (< 0.5) — see `code-benchmarks/confidence-mapping.ts`'s thresholds, reproduced independently in `security-benchmarks`' equivalent and never imported across the two. */
const LOW_CONFIDENCE_CAP = 0.3;

/**
 * Caps (never raises) a finding's confidence to `LOW_CONFIDENCE_CAP`
 * when its own description matches `ACKNOWLEDGED_UNCERTAINTY_PATTERN` —
 * enforces "never assert medium/high confidence while admitting the
 * behavior is unknown." The finding itself is kept; only its confidence
 * number changes, so a genuine, correctly-hedged observation is never
 * discarded, just labeled at the confidence its own wording already
 * implies.
 */
export function downgradeAcknowledgedUncertaintyConfidence(finding: ProviderFinding): ProviderFinding {
  if (!ACKNOWLEDGED_UNCERTAINTY_PATTERN.test(finding.description)) return finding;
  if (finding.confidence <= LOW_CONFIDENCE_CAP) return finding;
  return { ...finding, confidence: LOW_CONFIDENCE_CAP };
}

const CODE_QUOTE_PATTERN = /`([^`]+)`/g;
const ILLUSTRATIVE_EXAMPLE_MARKER = /\b(?:e\.g\.,?|for example,?|such as|like)\s*$/i;

/**
 * The shape of a bare identifier or dotted method/property reference,
 * optionally called with no arguments (`.filter()`, `pg.Pool.query`) —
 * the ONLY shape this module ever exempts from an exact source-text
 * match, and only once every dot-separated segment is independently
 * confirmed to appear as a real token in the finding's own file (see
 * `isVerifiableIdentifierReference`). Anything else — an arithmetic
 * expression, a call with any arguments, a sentence, anything containing
 * a space or an operator — is a CLAIM about specific code, not a generic
 * reference, and must match the source exactly or be redacted. This is
 * deliberately stricter than treating "has no punctuation" as safe:
 * `pageSize + 1` (a computed value) and `console.log(...)` (an
 * ellipsis-abbreviated call) both fail this shape test and are redacted,
 * which is exactly the literal-evidence discipline this reviewer's
 * tuned instructions ask for.
 */
const DOTTED_IDENTIFIER_SHAPE = /^\.?[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*(?:\(\))?$/;

function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whether `span` is shaped like a bare identifier/dotted reference
 * (`DOTTED_IDENTIFIER_SHAPE`) AND every one of its dot-separated segments
 * independently appears as a whole word somewhere in `sourceText` — a
 * span can look like a plausible method reference while still being
 * entirely invented (`some.fabricated.helper`), so shape alone is never
 * enough; each piece must be a real token the model could actually have
 * seen.
 */
function isVerifiableIdentifierReference(span: string, sourceText: string): boolean {
  if (!DOTTED_IDENTIFIER_SHAPE.test(span)) return false;
  const withoutCallParens = span.endsWith("()") ? span.slice(0, -2) : span;
  const segments = withoutCallParens.split(".").filter((segment) => segment.length > 0);
  return segments.length > 0 && segments.every((segment) => new RegExp(`\\b${escapeForRegExp(segment)}\\b`, "i").test(sourceText));
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Every added line's text for `filePath` in `context.diffText`, joined — what a reviewer could actually have seen for this file. */
function addedSourceTextForFile(context: ReviewContext, filePath: string): string {
  const file = parseUnifiedDiff(context.diffText).find((f) => f.path === filePath);
  return file ? file.addedLines.map((l) => l.content).join("\n") : "";
}

/**
 * Redacts a backtick-quoted span from `finding.description` when it (a)
 * cannot be found — case-insensitively, whitespace-normalized — anywhere
 * in this finding's own file's added lines, (b) is not introduced by an
 * explicit illustrative-example marker, and (c) is not a verifiable bare
 * identifier/dotted reference (`isVerifiableIdentifierReference`). Covers computed/derived
 * values described inside backticks (`` `pageSize + 1` `` when source
 * never writes that literal string) and ellipsis-abbreviated paraphrases
 * of a real call (`` `console.log(...)` `` standing in for a call with
 * different, longer arguments) — both are "not literal source text" by
 * the same test, so one check handles both. **The finding itself is
 * always kept**, even when a quote is redacted: only the specific
 * unverifiable claim is removed, never the whole detection, so one
 * imprecise quote never costs a real finding its recall.
 */
export function redactUnverifiableQuotes(finding: ProviderFinding, context: ReviewContext): ProviderFinding {
  if (!finding.filePath) return finding;
  const sourceText = collapseWhitespace(addedSourceTextForFile(context, finding.filePath)).toLowerCase();
  if (!sourceText) return finding;

  let changed = false;
  const description = finding.description.replace(CODE_QUOTE_PATTERN, (full: string, span: string, offset: number) => {
    const candidate = collapseWhitespace(span);
    if (candidate.length === 0) return full;
    if (sourceText.includes(candidate.toLowerCase())) return full;

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
 * import from the benchmark trees. No proximity padding — requiring true
 * overlap, not "nearby," keeps the false-merge risk for two genuinely
 * distinct, adjacent issues low.
 */
function sameLocation(a: ProviderFinding, b: ProviderFinding): boolean {
  if (a.filePath === null || b.filePath === null || a.filePath !== b.filePath) return false;
  if (a.lineStart === null || b.lineStart === null) return false;
  const aEnd = a.lineEnd ?? a.lineStart;
  const bEnd = b.lineEnd ?? b.lineStart;
  return a.lineStart <= bEnd && b.lineStart <= aEnd;
}

/** Collapses a group of same-root-cause findings into one survivor: the group's highest severity and confidence (the strongest evidence seen anywhere in the group should never be diluted by averaging), carried onto whichever single finding has the longest (most detailed) description. */
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
 * overlap (category-blind — the same root cause is often labeled
 * inconsistently across near-duplicate findings) and collapses each
 * group to its single strongest survivor. Never increases the finding
 * count, and never drops a group's highest severity/confidence — only
 * ever consolidates redundant restatements of the same location.
 *
 * Grouping is TRANSITIVE, not just pairwise against a single seed: if A
 * overlaps B and B overlaps C, all three merge into one group even when
 * A and C don't directly overlap each other. Two findings at genuinely
 * different, non-overlapping locations are never merged, even when they
 * both stem from the same function — this is what keeps genuinely
 * distinct root causes (e.g. an off-by-one on one line and a missing
 * validation earlier in the same function) reported separately.
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
 * Deterministic, content-based category canonicalization. The model
 * reliably identifies the right ROOT CAUSE but often labels it with a
 * broad, generic category (`correctness`, `maintainability`,
 * `performance`, `error-handling`, `concurrency`) even when its own
 * description clearly describes one specific, well-known defect shape.
 * Each rule below only fires when the finding's CURRENT category is
 * already in that same broad domain (`fromCategories`) AND the
 * description contains a strong, specific textual signature of the named
 * defect shape — this is deliberately conservative in both directions:
 * it never reclassifies a finding into an unrelated domain (a
 * `performance` finding is never turned into `correctness.off-by-one`,
 * even if it happens to mention "+1" somewhere), and it never invents a
 * signal that isn't already in the model's own words.
 *
 * The canonical target strings are exactly the ones this repo's own
 * `code-benchmarks/category-compat.ts` already recognizes as specific
 * (not the illustrative names from any one tuning request) — using any
 * other spelling would silently stop this from ever being recognized as
 * accurate by that (unmodified, per the tuning constraints) compatibility
 * layer, which would make this normalization actively counterproductive.
 */
interface CategoryCanonicalizationRule {
  fromCategories: readonly string[];
  pattern: RegExp;
  canonicalCategory: string;
}

const CATEGORY_CANONICALIZATION_RULES: readonly CategoryCanonicalizationRule[] = [
  {
    fromCategories: ["correctness"],
    pattern: /\boff.by.one\b|\bend\s*\+\s*1\b|\bone extra (?:item|element|row)\b|\bextra (?:item|element)s? (?:beyond|from) the (?:next|following)\b|\binclusive of (?:the )?end\b/i,
    canonicalCategory: "correctness.off-by-one",
  },
  {
    fromCategories: ["maintainability", "correctness"],
    pattern: /\bunreachable\b|\bdead code\b|\bwill never execute\b|\bnever runs?\b|\bnever reached\b/i,
    canonicalCategory: "dead-code.unreachable",
  },
  {
    fromCategories: ["correctness", "concurrency"],
    pattern: /\bforeach\b[\s\S]{0,60}\basync\b|\basync\b[\s\S]{0,60}\bforeach\b|\bdoes not (?:await|wait for)\b|\bmissing await\b|\bnot awaited\b|\bunhandled promise rejection\b|\bresolves? before\b/i,
    canonicalCategory: "concurrency.missing-await",
  },
  {
    fromCategories: ["error-handling"],
    pattern: /\bswallow(?:s|ed|ing)?\b|\bcatch block only logs\b|\bdiscards? the (?:error|exception)\b|\bsilently (?:fails|resolves)\b|\bnever rethrows?\b|\bno rethrow\b/i,
    canonicalCategory: "error-handling.swallowed-exception",
  },
  {
    fromCategories: ["performance"],
    pattern: /\blinear scan\b|\bnested loop\b|\bo\(n\s*\*\s*m\)\b|\bo\(n\^?2\)\b|\bquadratic\b|\bincludes\([^)]*\)[\s\S]{0,60}\bfilter\b/i,
    canonicalCategory: "performance.algorithmic-complexity",
  },
  {
    fromCategories: ["maintainability"],
    pattern: /\bduplicat/i,
    canonicalCategory: "maintainability.duplication",
  },
  {
    fromCategories: ["maintainability"],
    pattern: /\bdeeply nested\b|\bnesting\b|\bcognitive complexity\b|\bcyclomatic\b/i,
    canonicalCategory: "maintainability.complexity",
  },
];

/**
 * Applies the first matching `CATEGORY_CANONICALIZATION_RULES` entry to
 * each finding — never touches `severity`, `confidence`, or any other
 * field, and leaves a finding whose category is already specific, or
 * whose description doesn't match any rule, completely unchanged.
 */
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
 * The full code-reviewer-specific normalization pipeline. Order matters:
 * 1. Drop out-of-lane security categories first — a dropped finding
 *    never needs any of the later, more expensive steps.
 * 2. Drop hypothetical-future-evolution findings, speculative
 *    exhaustive-switch concerns, and standard `.slice()` negative-index
 *    complaints next, for the same reason — none of their premises are
 *    about a defect this diff actually demonstrates.
 * 3. Redact unverifiable quotes on each individual finding, before
 *    merging, so a later group-survivor selection (by description
 *    length) picks among already-cleaned descriptions.
 * 4. Merge same-root-cause duplicates.
 * 5. Canonicalize each merged finding's category from its own final
 *    (longest, post-merge) description — running this after the merge
 *    means canonicalization sees the most detailed surviving text rather
 *    than a shorter duplicate that might lack the specific signature
 *    phrase.
 * 6. Downgrade acknowledged-uncertainty confidence LAST — running this
 *    before the merge would be undone by `mergeGroup`'s
 *    max-confidence-across-group rule when only one finding in a
 *    duplicate group used hedged language.
 */
export function normalizeCodeOutput(output: AgentReviewOutput, context: ReviewContext): AgentReviewOutput {
  const withLane = dropSecurityCategories(output.findings);
  const withCurrentCodeOnly = dropStandardSliceNegativeIndexConcerns(dropUnreachableExhaustiveSwitchConcerns(dropHypotheticalFutureConcerns(withLane)));
  const withVerifiedEvidence = withCurrentCodeOnly.map((f) => redactUnverifiableQuotes(f, context));
  const merged = mergeDuplicateFindings(withVerifiedEvidence);
  const withCanonicalCategories = merged.map(canonicalizeCategory);
  const findings = withCanonicalCategories.map(downgradeAcknowledgedUncertaintyConfidence);
  return { ...output, findings };
}
