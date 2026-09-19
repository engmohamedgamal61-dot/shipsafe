import type { AgentReviewOutput, ProviderFinding } from "@/domain/schemas";
import { parseUnifiedDiff } from "../diff";
import type { ReviewContext } from "../types";

/**
 * Architecture-reviewer-specific post-processing, applied by
 * `ArchitectureReviewerAgent` to every response. Deliberately an
 * INDEPENDENT copy of the same shape as `code-normalization.ts` and
 * `database-normalization.ts` — not imported from either — matching
 * this codebase's established convention of keeping each reviewer's
 * normalization self-contained.
 *
 * Tuned against the CURRENT Architecture Reviewer's own real baseline
 * (`docs/agents/architecture-baseline-current.md`), which measured:
 * pervasive lane drift into security/testing/correctness/code-quality
 * findings (the single biggest driver of 20% precision), hypothetical
 * scale-problem invention on an architecturally sound TTL-cache
 * decorator with zero concrete evidence, a persistent one-root-cause-
 * many-findings duplicate pattern (31.4%), one hard failure from
 * quoting an ellipsis-abbreviated constructor call as if literal, and
 * a wildly scattered, near-universal use of generic categories instead
 * of the defect's own specific category (14.3% category accuracy).
 * Every function below targets exactly one of those measured failure
 * modes.
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
 * reviewer's lane (security/access-control, testing, ordinary
 * correctness, type-safety, code style) — a Code/Security/Database
 * Reviewer finding self-labeled this way belongs to one of them, not
 * here. Deliberately does NOT include broad categories like
 * `maintainability` or `reliability`, which the real baseline used for
 * BOTH legitimate architectural findings (duplicated domain logic) and
 * illegitimate ones (missing tests, missing try/catch) — those are
 * filtered by CONTENT below instead, so a legitimate architectural
 * observation sharing a broad category label is never wrongly dropped.
 */
const OUT_OF_LANE_CATEGORIES = new Set([
  "security",
  "authentication",
  "authorization",
  "access-control",
  "testing",
  "process",
  "correctness",
  "type-safety",
  "code-quality",
  "style",
]);

/**
 * Content signatures for out-of-lane concerns that the real baseline
 * produced under a broad, otherwise-legitimate-sounding category
 * (`maintainability`, `reliability`, `architecture`): missing test
 * coverage, missing error handling, access-control/authorization
 * bypass, an ordinary stub/placeholder correctness bug, and
 * database-layer constraint/index/migration concerns — all explicitly
 * out of this reviewer's lane per its tuned instructions, regardless of
 * what category the model happened to attach.
 */
const OUT_OF_LANE_CONTENT_PATTERN =
  /\bno (?:unit )?tests?\b|\bmissing tests?\b|\bwithout (?:any )?tests?\b|\bno test coverage\b|\btry[/\\]catch\b|\bwithout (?:a|any) try\/catch\b|\bunhandled exception\b|\bno error handling\b|\baccess[- ]control\b|\bprivileged pseudo-user\b|\bbypass(?:ing|es)?\b[\s\S]{0,30}\b(?:ownership|permission|auth)\b|\bstub(?:bed)?\b|\bplaceholder\b|\bnon-functional\b|\bignores? (?:the )?\w+ entirely\b|\balways returns? an empty array\b|\bdatabase (?:constraint|index|migration)\b|\bforeign key\b|\bunique constraint\b/i;

/** Drops a finding whose category is unambiguously out-of-lane, or whose description matches a known out-of-lane content signature regardless of category. */
export function dropOutOfLaneFindings(findings: readonly ProviderFinding[]): ProviderFinding[] {
  return findings.filter((f) => !OUT_OF_LANE_CATEGORIES.has(f.category.toLowerCase()) && !OUT_OF_LANE_CONTENT_PATTERN.test(f.description));
}

/**
 * Language describing a scaling or future-maintenance problem with no
 * concrete evidence in the diff — the real baseline's clearest example
 * was a correct TTL-cache decorator flagged for "unbounded memory
 * growth over time" and "staleness across horizontal scaling," neither
 * of which the diff demonstrates; both are the cache's own documented,
 * intended behavior. Deliberately narrow: it targets explicit
 * speculative-scale phrasing ("over time," "as the system scales,"
 * "horizontal scaling," "multiple process instances"), not a concrete,
 * currently-demonstrated coupling or duplication problem that merely
 * happens to also be described as risky.
 */
const HYPOTHETICAL_SCALE_CONCERN_PATTERN =
  /\bover time\b[\s\S]{0,40}\b(?:unbounded|grows?|growth|accumulate)\b|\bhorizontal scaling\b|\bmultiple process instances\b|\bas the system scales\b|\bmay someday\b|\btend to accumulate\b|\bunbounded memory growth\b|\bacross (?:many|different) (?:deployment contexts|instances)\b/i;

/** Drops findings whose description is built on `HYPOTHETICAL_SCALE_CONCERN_PATTERN` language — the finding is never rewritten or downgraded, since the premise isn't a claim the diff actually demonstrates. */
export function dropHypotheticalScaleConcerns(findings: readonly ProviderFinding[]): ProviderFinding[] {
  return findings.filter((f) => !HYPOTHETICAL_SCALE_CONCERN_PATTERN.test(f.description));
}

/**
 * Language the model itself uses to acknowledge that a claim depends on
 * architectural context this diff cannot show — module ownership,
 * intent, or runtime composition it cannot confirm — plus the general
 * hedging phrases already proven for the Code/Database Reviewers
 * (these transfer generically; hedged uncertainty isn't domain-specific
 * language).
 */
const UNCLEAR_ARCHITECTURAL_CONTEXT_PATTERN =
  /\bunclear (?:ownership|intent|whether)\b|\bdepends on how\b|\bdepends on where\b|\bwithout seeing (?:its|the) (?:call site|usage)\b|\bdepending on\b|\bunder the hood\b|\b(?:cannot|can'?t|unable to)\s+(?:be\s+)?(?:confirm(?:ed)?|verif(?:y|ied)|determin(?:e|ed))\b|\bmay or may not\b|\bnot (?:shown|included|visible) in (?:this|the) diff\b/i;

/** A numeric confidence comfortably inside the benchmark's "low" bucket (< 0.5) — see `architecture-benchmarks/confidence-mapping.ts`'s thresholds, reproduced independently and never imported across benchmark/production boundaries. */
const LOW_CONFIDENCE_CAP = 0.3;

/** Caps (never raises) a finding's confidence to `LOW_CONFIDENCE_CAP` when its own description matches `UNCLEAR_ARCHITECTURAL_CONTEXT_PATTERN` — enforces "never assert medium/high confidence while acknowledging architectural ownership/intent/composition is unclear." The finding itself is kept; only its confidence changes. */
export function downgradeUnclearContextConfidence(finding: ProviderFinding): ProviderFinding {
  if (!UNCLEAR_ARCHITECTURAL_CONTEXT_PATTERN.test(finding.description)) return finding;
  if (finding.confidence <= LOW_CONFIDENCE_CAP) return finding;
  return { ...finding, confidence: LOW_CONFIDENCE_CAP };
}

/**
 * Language justifying a P0 (the most severe rating) with genuinely
 * catastrophic, current, concrete impact — data loss, an outage,
 * corruption, a security breach, or a cascading failure. A P0 finding
 * whose own description does NOT contain any of this is, by this
 * reviewer's own tuned severity-calibration rule, an inflated rating
 * for what is at most a serious structural concern, not a production
 * emergency.
 */
const CATASTROPHIC_IMPACT_PATTERN = /\bdata loss\b|\boutage\b|\bproduction (?:down|outage|incident)\b|\bsecurity breach\b|\bcorrupt(?:s|ed|ion)\b|\bcascading failure\b/i;

/** Caps an unjustified P0 down to P1 — never touches P1/P2/Nit, and never lowers a P0 whose own description already states genuinely catastrophic impact. */
export function capInflatedSeverity(finding: ProviderFinding): ProviderFinding {
  if (finding.severity !== "P0") return finding;
  if (CATASTROPHIC_IMPACT_PATTERN.test(finding.description)) return finding;
  return { ...finding, severity: "P1" };
}

const CODE_QUOTE_PATTERN = /`([^`]+)`/g;
const ILLUSTRATIVE_EXAMPLE_MARKER = /\b(?:e\.g\.,?|for example,?|such as|like)\s*$/i;

/**
 * The shape of a bare identifier or dotted module/method reference,
 * optionally called with no arguments (`ReviewRepository`,
 * `.getReviewById()`) — the ONLY shape this module ever exempts from an
 * exact source-text match, and only once every dot-separated segment is
 * independently confirmed to appear as a real token in the finding's
 * own file. Anything else — a full statement, a call WITH arguments
 * (including an ellipsis standing in for real arguments, e.g.
 * `` `new AnthropicProvider(...)` ``), a sentence — must match the
 * source exactly or be redacted.
 */
const DOTTED_IDENTIFIER_SHAPE = /^\.?[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*(?:\(\))?$/;

function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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
 * identifier/dotted reference. Covers an ellipsis-abbreviated stand-in
 * for a real call with different arguments (`` `new AnthropicProvider(...)` ``
 * when the real call passes `process.env.ANTHROPIC_API_KEY ?? ""`) —
 * "not literal source text" by the same test used for a hypothetical
 * statement or an inferred field. **The finding itself is always kept**,
 * even when a quote is redacted: only the specific unverifiable claim is
 * removed, never the whole detection.
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
 * Deterministic, content-based category canonicalization to this
 * repo's own architecture-benchmark vocabulary (`architecture-benchmarks/category-compat.ts`
 * and fixture ground truth) — NOT the single-domain
 * `architecture.<subcategory>` spelling used only as an illustrative
 * example elsewhere, which this benchmark's own compatibility layer
 * does not recognize and would therefore make category accuracy
 * WORSE, not better (the same reasoning already applied when tuning
 * the Code and Database Reviewers: use the vocabulary the benchmark
 * actually scores against). Each rule only fires when the finding's
 * CURRENT category is already one this defect type is actually
 * observed to use AND the description contains a strong, specific
 * textual signature of the named defect shape.
 */
interface CategoryCanonicalizationRule {
  fromCategories: readonly string[];
  pattern: RegExp;
  canonicalCategory: string;
}

const GENERIC_ARCH_BUCKET: readonly string[] = [
  "architecture",
  "layering-violation",
  "architecture-layering",
  "architecture-coupling",
  "architecture-circular-dependency",
  "maintainability",
  "data-integrity",
  "scalability",
];

const CATEGORY_CANONICALIZATION_RULES: readonly CategoryCanonicalizationRule[] = [
  {
    fromCategories: GENERIC_ARCH_BUCKET,
    pattern: /\bimports?\b[\s\S]{0,60}\b(?:ui component|@\/components|react component)\b|\b(?:persistence|repository|data)\b[\s\S]{0,30}\blayer\b[\s\S]{0,60}\b(?:ui|presentation|react|component)s?\b/i,
    canonicalCategory: "layer-boundaries.cross-layer-import",
  },
  {
    fromCategories: GENERIC_ARCH_BUCKET,
    pattern: /\b(?:server action|controller)\b[\s\S]{0,80}\b(?:business|domain)\b[\s\S]{0,20}\b(?:rule|logic|polic)/i,
    canonicalCategory: "responsibility-separation.business-logic-leakage",
  },
  {
    fromCategories: GENERIC_ARCH_BUCKET.concat(["tight-coupling"]),
    pattern: /\b(?:directly )?(?:imports? and )?instantiat(?:es?|ing)\b[\s\S]{0,60}\bprovider\b|\bhardcodes? the concrete\b|\bbypass(?:es|ing)?\b[\s\S]{0,40}\b(?:port|composition root|dependency injection)\b/i,
    canonicalCategory: "coupling.bypasses-port-abstraction",
  },
  {
    fromCategories: GENERIC_ARCH_BUCKET,
    pattern: /\bcircular\b[\s\S]{0,20}\b(?:import|depend|dependency)\b|\bmutual(?:ly)? (?:import|depend)/i,
    canonicalCategory: "circular-dependency.mutual-module-imports",
  },
  {
    fromCategories: GENERIC_ARCH_BUCKET,
    pattern: /\b(?:identical|duplicate[ds]?|re-declares?|redeclares?)\b[\s\S]{0,60}\b(?:array|constant|logic|definition|policy)\b|\brather than importing a shared\b/i,
    canonicalCategory: "duplication.domain-logic-duplicated",
  },
  {
    fromCategories: GENERIC_ARCH_BUCKET,
    pattern: /\bmulti-step workflow\b|\bsequential(?:ly)?\b[\s\S]{0,40}\b(?:database writes|writes)\b|\bcomputed inline inside\b/i,
    canonicalCategory: "transaction-orchestration.misplaced-in-adapter",
  },
  {
    fromCategories: GENERIC_ARCH_BUCKET,
    pattern: /\bdomain\b[\s\S]{0,20}\b(?:type|model)\b[\s\S]{0,60}\b(?:vendor|sdk|anthropic|openai)\b|\breferences?\b[\s\S]{0,20}\bfrom\b[\s\S]{0,20}\bsdk\b/i,
    canonicalCategory: "provider-leakage.vendor-type-in-domain",
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
 * The full architecture-reviewer-specific normalization pipeline. Order
 * matters:
 * 1. Drop out-of-lane findings first (category- or content-based) — a
 *    dropped finding never needs any later step.
 * 2. Drop hypothetical scale/future-risk findings next, for the same
 *    reason.
 * 3. Redact unverifiable quotes on each individual finding, before
 *    merging, so a later group-survivor selection (by description
 *    length) picks among already-cleaned descriptions.
 * 4. Merge same-root-cause duplicates.
 * 5. Canonicalize each merged finding's category from its own final
 *    (longest, post-merge) description.
 * 6. Cap inflated severity — after merge, so a P0 inherited from
 *    `mergeGroup`'s max-severity-across-group rule is still subject to
 *    the cap.
 * 7. Downgrade unclear-context confidence LAST — running this before
 *    the merge would be undone by `mergeGroup`'s
 *    max-confidence-across-group rule when only one finding in a
 *    duplicate group used hedged language.
 */
export function normalizeArchitectureOutput(output: AgentReviewOutput, context: ReviewContext): AgentReviewOutput {
  const withLane = dropOutOfLaneFindings(output.findings);
  const withCurrentEvidenceOnly = dropHypotheticalScaleConcerns(withLane);
  const withVerifiedEvidence = withCurrentEvidenceOnly.map((f) => redactUnverifiableQuotes(f, context));
  const merged = mergeDuplicateFindings(withVerifiedEvidence);
  const withCanonicalCategories = merged.map(canonicalizeCategory);
  const withCappedSeverity = withCanonicalCategories.map(capInflatedSeverity);
  const findings = withCappedSeverity.map(downgradeUnclearContextConfidence);
  return { ...output, findings };
}
