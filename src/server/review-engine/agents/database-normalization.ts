import type { AgentReviewOutput, ProviderFinding } from "@/domain/schemas";
import { parseUnifiedDiff } from "../diff";
import type { ReviewContext } from "../types";

/**
 * Database-reviewer-specific post-processing, applied by
 * `DatabaseReviewerAgent` to every response. Deliberately an
 * INDEPENDENT copy of the same shape as `code-normalization.ts` and
 * `security-normalization.ts` — not imported from either — matching
 * this codebase's established convention of keeping each reviewer's
 * normalization self-contained.
 *
 * Tuned against the CURRENT Database Reviewer's own real baseline
 * (`docs/agents/database-baseline-current.md`), which measured: RLS/
 * tenant-isolation findings on BOTH "safe" fixtures despite that ground
 * being the Security Reviewer's (25.9%→23.5% precision was dominated by
 * this one pattern), a persistent one-root-cause-many-findings duplicate
 * pattern (32.4% duplicate rate), two hard failures from quoting a
 * hypothetical SQL statement or an inferred-but-undestructured response
 * field as if literal, confident findings on a fixture whose real-world
 * impact depends on unseen table size/traffic, and near-universal use of
 * the generic `data-integrity` category instead of the defect's own
 * specific canonical category (0% category accuracy). Every function
 * below targets exactly one of those measured failure modes.
 *
 * Every function here is pure and deterministic (no model calls) and
 * never INCREASES the number of findings or invents content — each step
 * only removes, redacts, downgrades, or consolidates what the model
 * already produced, so a genuine detection is never manufactured, only
 * cleaned up.
 */

const SEVERITY_RANK: Record<ProviderFinding["severity"], number> = { NIT: 0, P2: 1, P1: 2, P0: 3 };

/**
 * Category labels that name a security/access-control concern rather
 * than a database-layer defect (schema integrity, transactions,
 * constraints, migrations, query behavior, data consistency) — the
 * Security Reviewer already covers RLS/auth/tenant-isolation with its
 * own evidence/ambiguity discipline, so a Database Reviewer finding
 * self-labeled this way is out of lane. Deliberately a SMALL, explicit
 * deny-list, not a broad allow-list.
 */
const SECURITY_CATEGORIES = new Set([
  "security",
  "security/data-integrity",
  "rls",
  "row-level-security",
  "tenant-isolation",
  "authentication",
  "authorization",
  "access-control",
  "prompt-injection",
]);

/** Drops a finding whose category is one of `SECURITY_CATEGORIES`. */
function dropSecurityCategories(findings: readonly ProviderFinding[]): ProviderFinding[] {
  return findings.filter((f) => !SECURITY_CATEGORIES.has(f.category.toLowerCase()));
}

/**
 * Language that is fundamentally about row-level security, policies,
 * role-based grants, or cross-tenant access control — an RLS/auth
 * concern the model frequently mislabels under a generic category (most
 * often `data-integrity`), confirmed by this reviewer's own real
 * baseline runs ("does not enable row level security", "readable/
 * writable by any role", "cross-tenant data leakage"). Deliberately
 * requires explicit access-control/policy/grant/RLS terminology, NOT a
 * bare mention of "tenant" — a legitimate schema-layer observation (e.g.
 * a unique constraint that omits the tenant column, allowing a
 * cross-tenant collision at the CONSTRAINT level) never mentions RLS,
 * policies, roles, or grants at all, so it is never caught by this
 * pattern and must still be reported.
 */
const RLS_AUTH_CONCERN_PATTERN =
  /\brow[- ]level security\b|\brls\b|\bcreate policy\b|\b(?:no|missing|lacks?|without|absence of)\s+(?:rls|(?:any )?polic(?:y|ies))\b|\b(?:anon|authenticated|service_role)\s+role\b|\bgrant\b[\s\S]{0,40}\brole\b|\baccess (?:control|polic(?:y|ies))\b|\bcross-tenant (?:data )?(?:leak(?:age)?|access|tampering)\b|\breadable\/writable by any role\b|\bexposed via (?:api|postgrest)\b/i;

/** Drops a finding whose category is a security category OR whose description is fundamentally about RLS/policy/grant-based access control. */
export function dropRlsAndAuthConcerns(findings: readonly ProviderFinding[]): ProviderFinding[] {
  return dropSecurityCategories(findings).filter((f) => !RLS_AUTH_CONCERN_PATTERN.test(f.description));
}

/**
 * Language the model itself uses to acknowledge that a claim depends on
 * production context this diff cannot show — table size, write traffic,
 * deployment timing/window, or general "this can't be assessed from
 * what's shown" hedging.
 */
const UNSEEN_PRODUCTION_CONTEXT_PATTERN =
  /\bdepends (?:entirely )?on\b[\s\S]{0,60}\b(?:table size|traffic|load|deployment|production)\b|\bif (?:the|this)\b[\s\S]{0,25}\btable is large\b|\bwithout (?:knowing|seeing)\b|\bcannot be (?:determined|confirmed|assessed)\b|\bimpossible to assess\b|\bno information about\b[\s\S]{0,60}\b(?:size|traffic|table|volume)\b|\bunknown (?:table size|traffic|production context)\b|\bdeployment window\b|\bdepending on\b|\bunder the hood\b|\b(?:cannot|can'?t|unable to)\s+(?:be\s+)?(?:confirm(?:ed)?|verif(?:y|ied)|be sure|determin(?:e|ed))\b|\bnot (?:shown|included|visible) in (?:this|the) diff\b/i;

/** A numeric confidence comfortably inside the benchmark's "low" bucket (< 0.5) — see `database-benchmarks/confidence-mapping.ts`'s thresholds, reproduced independently and never imported across benchmark/production boundaries. */
const LOW_CONFIDENCE_CAP = 0.3;

/**
 * Caps (never raises) a finding's confidence to `LOW_CONFIDENCE_CAP`
 * when its own description matches `UNSEEN_PRODUCTION_CONTEXT_PATTERN`
 * — enforces "never assert medium/high confidence while acknowledging
 * the relevant context (table size, traffic, deployment timing) is
 * unknown." The finding itself is kept; only its confidence changes.
 */
export function downgradeUnseenContextConfidence(finding: ProviderFinding): ProviderFinding {
  if (!UNSEEN_PRODUCTION_CONTEXT_PATTERN.test(finding.description)) return finding;
  if (finding.confidence <= LOW_CONFIDENCE_CAP) return finding;
  return { ...finding, confidence: LOW_CONFIDENCE_CAP };
}

const CODE_QUOTE_PATTERN = /`([^`]+)`/g;
const ILLUSTRATIVE_EXAMPLE_MARKER = /\b(?:e\.g\.,?|for example,?|such as|like)\s*$/i;

/**
 * The shape of a bare identifier or dotted table/column/method
 * reference, optionally called with no arguments (`public.workspaces`,
 * `.eq()`) — the ONLY shape this module ever exempts from an exact
 * source-text match, and only once every dot-separated segment is
 * independently confirmed to appear as a real token in the finding's
 * own file. Anything else — a full SQL statement, a call with any
 * arguments, a sentence — must match the source exactly or be redacted.
 * This is what catches a hypothetical `enable row level security;`
 * statement that was never written, and an inferred `error`/`status`
 * response field that was never destructured, while still allowing a
 * genuine, verifiable reference like `public.workspaces`.
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
 * identifier/dotted reference. Covers a hypothetical SQL statement that
 * was never written (`` `alter table ... enable row level security;` ``
 * when no such line exists) and an inferred response field that was
 * never destructured (`` `error` ``/`` `status` `` when the code never
 * names them) — both are "not literal source text" by the same test.
 * **The finding itself is always kept**, even when a quote is redacted:
 * only the specific unverifiable claim is removed, never the whole
 * detection, so one imprecise quote never costs a real finding its
 * recall.
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
 * drops a group's highest severity/confidence — only ever consolidates
 * redundant restatements of the same location. Grouping is TRANSITIVE:
 * if A overlaps B and B overlaps C, all three merge even when A and C
 * don't directly overlap. Two findings at genuinely different,
 * non-overlapping locations are never merged, which is what keeps
 * distinct root causes (e.g. a missing foreign key and a separate
 * missing-index observation elsewhere) reported separately.
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
 * reliably identifies the right ROOT CAUSE but overwhelmingly labels it
 * with the generic `data-integrity` bucket (confirmed: 0% category
 * accuracy in the real baseline, across foreign-key, nullability,
 * cascade, race-condition, and transaction-boundary findings alike).
 * Each rule only fires when the finding's CURRENT category is already
 * in the generic bucket(s) this defect type is actually observed to use
 * AND the description contains a strong, specific textual signature of
 * the named defect shape — conservative in both directions: never
 * reclassifies into an unrelated domain, never invents a signal that
 * isn't already in the model's own words.
 *
 * The canonical target strings are exactly the ones this repo's own
 * `database-benchmarks/category-compat.ts` and fixture ground truth
 * already use (not necessarily the illustrative names from any one
 * tuning request) — using any other spelling would silently stop this
 * from ever being recognized as accurate by that (unmodified, per the
 * tuning constraints) compatibility layer.
 */
interface CategoryCanonicalizationRule {
  fromCategories: readonly string[];
  pattern: RegExp;
  canonicalCategory: string;
}

const GENERIC_INTEGRITY_BUCKET = ["data-integrity", "database-integrity"] as const;
const GENERIC_MIGRATION_BUCKET = ["migration-safety", "database-migration-safety", "database-migration", "migration"] as const;
const GENERIC_PERFORMANCE_BUCKET = ["performance", "database-indexing", "database-performance"] as const;

const CATEGORY_CANONICALIZATION_RULES: readonly CategoryCanonicalizationRule[] = [
  {
    fromCategories: GENERIC_INTEGRITY_BUCKET,
    pattern: /\b(?:lacks?|missing|without|no)\b[\s\S]{0,40}\bforeign key\b|\bforeign key\b[\s\S]{0,60}\b(?:missing|does not|is not declared|no\b)|\breferential integrity\b|\borphaned (?:rows|records|deliver)/i,
    canonicalCategory: "foreign-keys.missing-reference",
  },
  {
    fromCategories: GENERIC_INTEGRITY_BUCKET,
    pattern: /\bwithout a not null\b|\bno not null\b|\bnullable\b[\s\S]{0,60}\b(?:should|must|invalid|semantically)\b|\ballows? (?:a )?(?:row|record)s? to be inserted with\b.{0,20}\bnull\b/i,
    canonicalCategory: "nullability.missing-not-null",
  },
  {
    fromCategories: GENERIC_INTEGRITY_BUCKET,
    pattern: /\bon delete cascade\b[\s\S]{0,120}\b(?:audit|erase|delete|wipe|lose|destroy|history)\b|\bcascad(?:e|es|ing)\b[\s\S]{0,80}\b(?:audit|erase|wipe|lose|destroy)\b/i,
    canonicalCategory: "cascade-delete.unsafe-cascade",
  },
  {
    fromCategories: GENERIC_INTEGRITY_BUCKET,
    pattern: /\brace condition\b|\bconcurrent\b[\s\S]{0,60}\b(?:duplicate|race)\b|\bno unique\b[\s\S]{0,40}\bindex\b|\bmissing (?:a |an )?unique\b/i,
    canonicalCategory: "race-condition.missing-unique-constraint",
  },
  {
    fromCategories: GENERIC_MIGRATION_BUCKET,
    pattern: /\badd column\b[\s\S]{0,60}\bnot null\b|\bno default\b[\s\S]{0,40}\b(?:not null|column)\b|\balter table\b[\s\S]{0,80}\bfail\b/i,
    canonicalCategory: "migration-safety.unsafe-not-null-addition",
  },
  {
    fromCategories: GENERIC_PERFORMANCE_BUCKET,
    pattern: /\bn\+1\b|\bn-plus-one\b|\bloops? over\b[\s\S]{0,60}\b(?:quer(?:y|ies))\b|\bseparate\b[\s\S]{0,40}\bquer(?:y|ies)\b[\s\S]{0,40}\b(?:each|per|for)\b|\bround[- ]trips?\b/i,
    canonicalCategory: "performance.n-plus-one",
  },
  {
    fromCategories: GENERIC_INTEGRITY_BUCKET,
    pattern: /\bno (?:surrounding |shared )?transaction\b|\bnon-atomic\b|\btwo (?:separate|independent)\b[\s\S]{0,60}\b(?:update|write|call)/i,
    canonicalCategory: "transaction-boundary.non-atomic-multi-step-write",
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
 * The full database-reviewer-specific normalization pipeline. Order
 * matters:
 * 1. Drop out-of-lane RLS/auth/security findings first (category- or
 *    content-based) — a dropped finding never needs any later step.
 * 2. Redact unverifiable quotes on each individual finding, before
 *    merging, so a later group-survivor selection (by description
 *    length) picks among already-cleaned descriptions.
 * 3. Merge same-root-cause duplicates.
 * 4. Canonicalize each merged finding's category from its own final
 *    (longest, post-merge) description.
 * 5. Downgrade unseen-production-context confidence LAST — running this
 *    before the merge would be undone by `mergeGroup`'s
 *    max-confidence-across-group rule when only one finding in a
 *    duplicate group used hedged language.
 */
export function normalizeDatabaseOutput(output: AgentReviewOutput, context: ReviewContext): AgentReviewOutput {
  const withLane = dropRlsAndAuthConcerns(output.findings);
  const withVerifiedEvidence = withLane.map((f) => redactUnverifiableQuotes(f, context));
  const merged = mergeDuplicateFindings(withVerifiedEvidence);
  const withCanonicalCategories = merged.map(canonicalizeCategory);
  const findings = withCanonicalCategories.map(downgradeUnseenContextConfidence);
  return { ...output, findings };
}
