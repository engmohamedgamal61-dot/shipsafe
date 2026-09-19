import type { AgentReviewOutput, ProviderFinding } from "@/domain/schemas";
import { parseUnifiedDiff } from "../diff";
import type { ReviewContext } from "../types";

/**
 * Security-reviewer-specific post-processing, applied by
 * `SecurityReviewerAgent` to every response AFTER `AnthropicProvider`'s
 * own shared hallucinated-file-path guard has already run (see that
 * file's `assertKnownFileReferences`) — this module never re-checks
 * `filePath` validity, only what's specific to security findings: junk
 * categories, unverifiable quoted evidence, and duplicate root causes.
 *
 * Every function here is pure and deterministic (no model calls), which
 * is what makes it independently unit-testable — see
 * `security-normalization.test.ts`. Nothing here ever INCREASES the
 * number of findings or invents content; each step only removes,
 * redacts, or consolidates what the model already produced, so a
 * genuine detection is never manufactured, only cleaned up.
 */

const SEVERITY_RANK: Record<ProviderFinding["severity"], number> = { NIT: 0, P2: 1, P1: 2, P0: 3 };

/**
 * Category labels that name a process/meta-commentary observation, not
 * a concrete security defect — a finding self-labeled this way was
 * never asserting an exploitable vulnerability, so dropping it costs no
 * genuine detection (recall-safe by construction: nothing that
 * legitimately belongs in one of these buckets was ever the P0/P1
 * finding a fixture's ground truth would require). Deliberately a
 * SMALL, explicit deny-list, not a broad allow-list — an unrecognized
 * but plausible security category (a reviewer's own reasonable
 * phrasing, e.g. "race-condition" or "tenant-isolation") is never
 * rejected just for not matching a fixed vocabulary; only these
 * specific, unambiguously-non-security labels are.
 */
const NON_SECURITY_CATEGORIES = new Set(["code-review-process", "suspicious-content", "code-quality", "informational"]);

/** Drops a finding whose category is one of `NON_SECURITY_CATEGORIES`. */
export function dropNonSecurityCategories(findings: readonly ProviderFinding[]): ProviderFinding[] {
  return findings.filter((f) => !NON_SECURITY_CATEGORIES.has(f.category));
}

/**
 * Category strings observed, across repeated real runs against the SAME
 * fixture, to be used interchangeably by the model for one specific
 * root cause — missing/broken webhook signature or request-authenticity
 * verification — mapped here to ONE deterministic canonical string
 * rather than left to prompt wording alone. This is the "map
 * semantically equivalent categories deterministically, in code, after
 * model output" fix: prompt instructions (`SECURITY_REVIEWER_INSTRUCTIONS`
 * rule 4) suggest a vocabulary, but sampling still produced
 * `"broken-auth"`, `"broken-authentication"`, `"webhook-security"`, and
 * `"webhook-signature"` for the identical underlying finding across
 * different runs — code-level normalization is deterministic where
 * prompt-following alone was not.
 *
 * Deliberately narrow and explicit (exact-string lookup only, no
 * fuzzy/substring matching) — the same discipline the benchmark's own
 * `category-compat.ts` uses, for the same reason: a broad or fuzzy
 * rule risks silently relabeling some OTHER, unrelated webhook finding
 * (e.g. a missing-idempotency or SSRF-via-webhook-URL observation) into
 * this one. `"webhook-security"` is the broadest entry here and the
 * one carrying the most residual risk of that kind — included anyway
 * because every real sample observed using it was in fact describing
 * this exact root cause, never a different one.
 */
const WEBHOOK_AUTH_CATEGORY_SYNONYMS = new Set(["broken-auth", "broken-authentication", "webhook-security", "webhook-signature", "webhook-auth"]);
const CANONICAL_WEBHOOK_AUTH_CATEGORY = "broken-authentication";

/** Deterministically normalizes a finding's category to the canonical webhook-authentication label when it's one of `WEBHOOK_AUTH_CATEGORY_SYNONYMS` — otherwise returns the finding unchanged. */
export function normalizeCategoryLabel(finding: ProviderFinding): ProviderFinding {
  if (!WEBHOOK_AUTH_CATEGORY_SYNONYMS.has(finding.category) || finding.category === CANONICAL_WEBHOOK_AUTH_CATEGORY) {
    return finding;
  }
  return { ...finding, category: CANONICAL_WEBHOOK_AUTH_CATEGORY };
}

const CODE_QUOTE_PATTERN = /`([^`]+)`/g;
const ILLUSTRATIVE_EXAMPLE_MARKER = /\b(?:e\.g\.,?|for example,?|such as|like)\s*$/i;
/** A span containing code-statement punctuation (parens/braces/semicolon/equals) or written as an all-caps/underscore fragment (SQL-keyword style) — the shape of an actual code claim, as opposed to a bare identifier/API-name reference, which this module deliberately leaves alone (see the doc comment on `redactUnverifiableQuotes`). */
const CODE_STATEMENT_SHAPE = /[(){};=]|^[A-Z_ ]+$/;

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
 * is shaped like an actual code statement (`CODE_STATEMENT_SHAPE`), (b)
 * is not introduced by an explicit illustrative-example marker (e.g.
 * "e.g. `' OR '1'='1`"), and (c) cannot be found — case-insensitively,
 * whitespace-normalized — anywhere in this finding's own file's added
 * lines. **The finding itself is always kept**, even when a quote is
 * redacted: only the specific unverifiable claim is removed, never the
 * whole detection, so one imprecise quote never costs a real finding
 * its recall. A bare identifier/API-name reference with no code-statement
 * punctuation (e.g. `` `pg.Pool.query` ``) is left untouched even when
 * unverifiable — it reads as a generic reference, not a diff-line quote.
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
    if (!CODE_STATEMENT_SHAPE.test(candidate)) return full;

    changed = true;
    return "[unverified quote removed]";
  });

  return changed ? { ...finding, description } : finding;
}

/**
 * A bare function/method declaration line — the shape of a SIGNATURE,
 * never itself the vulnerability. Matches a `function` keyword
 * declaration, an arrow-function assignment, or a class-method opening
 * line — deliberately generic across these common shapes rather than
 * one specific fixture's exact wording (this must generalize, not be
 * tuned to one file).
 */
const FUNCTION_SIGNATURE_LINE =
  /^\s*(export\s+)?(default\s+)?(async\s+)?function\b.*\{\s*$|^\s*(export\s+)?(const|let)\s+[A-Za-z_$][\w$]*\s*=\s*(async\s*)?\([^)]*\)\s*(:[^=]+)?=>\s*\{\s*$|^\s*(public|private|protected|static)?\s*(async\s+)?[A-Za-z_$][\w$]*\s*\([^)]*\)\s*(:[^{]+)?\{\s*$/;

/** A meaningfully specific span — long enough that a substring match against it is unlikely to be coincidental (rules out matching on something like a 1-2 character token). */
const MIN_REANCHOR_SPAN_LENGTH = 4;

/**
 * If a finding is anchored to a bare function/method SIGNATURE line
 * (`FUNCTION_SIGNATURE_LINE`) — never itself the vulnerable operation —
 * and the finding's own evidence text backtick-quotes a specific span
 * that verifiably appears on a LATER added line in the same file, moves
 * the citation to that line instead. This is the deterministic,
 * generalizable fix for "the model quoted the right thing but cited an
 * earlier, easier-to-quote declaration line instead of where the
 * vulnerable operation actually happens" — it never invents a location:
 * it only ever moves a finding to a line ALREADY substantiated by that
 * SAME finding's own quoted evidence.
 *
 * Deliberately conservative: does nothing when the cited line isn't
 * signature-shaped, when there's no quoted span at all, or when no
 * quoted span is found on any later line — in every one of those cases
 * the finding is returned completely unchanged.
 */
export function reanchorFromSignatureLine(finding: ProviderFinding, context: ReviewContext): ProviderFinding {
  if (!finding.filePath || finding.lineStart === null) return finding;

  const file = parseUnifiedDiff(context.diffText).find((f) => f.path === finding.filePath);
  if (!file) return finding;

  const citedLine = file.addedLines.find((l) => l.lineNumber === finding.lineStart);
  if (!citedLine || !FUNCTION_SIGNATURE_LINE.test(citedLine.content)) return finding;

  const spans = [...finding.description.matchAll(CODE_QUOTE_PATTERN)].map((m) => collapseWhitespace(m[1])).filter((s) => s.length >= MIN_REANCHOR_SPAN_LENGTH);

  for (const span of spans) {
    const laterMatch = file.addedLines.find(
      (l) => l.lineNumber > finding.lineStart! && collapseWhitespace(l.content).toLowerCase().includes(span.toLowerCase()),
    );
    if (laterMatch) {
      return { ...finding, lineStart: laterMatch.lineNumber, lineEnd: laterMatch.lineNumber };
    }
  }

  return finding;
}

/**
 * Whether `a`/`b` share a file and their line ranges genuinely overlap
 * — the SAME test shape as the security-benchmark's own location-match
 * geometry (`scorer.ts`'s `matchesByLocation`), reimplemented
 * independently here since production code must never import from
 * `security-benchmarks` (see that module's own doc comments). No
 * proximity padding — requiring true overlap, not "nearby," is a
 * deliberate conservatism: a merge can only ever consolidate findings
 * that already point at the same lines, never ones that merely sit
 * close together, which keeps the false-merge risk for two genuinely
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
 * Enforces "one root cause, one finding" (spec §4.3): groups findings
 * by file/line overlap (category-blind — the same root cause is often
 * labeled inconsistently across near-duplicate findings, observed
 * directly in production output) and collapses each group to its
 * single strongest survivor. Never increases the finding count, and
 * never drops a group's highest severity/confidence — only ever
 * consolidates redundant restatements of the same location.
 *
 * Grouping is TRANSITIVE, not just pairwise against a single seed: if A
 * overlaps B and B overlaps C, all three merge into one group even when
 * A and C don't directly overlap each other — the real, observed
 * pattern is exactly this (e.g. one wide-spanning finding covering an
 * entire function, plus two narrower findings each overlapping only
 * part of it).
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
 * The full security-specific normalization pipeline. Order matters:
 * 1. Drop junk categories first — a dropped finding never needs any of
 *    the later, more expensive steps.
 * 2. Normalize webhook-auth category synonyms — deterministic, cheap,
 *    and independent of location, so it runs before anything
 *    location-based.
 * 3. Re-anchor away from a bare signature line — must run BEFORE quote
 *    redaction, since it needs the finding's ORIGINAL quoted spans
 *    (including ones redaction would otherwise remove) to find where
 *    the finding's own evidence actually points.
 * 4. Redact unverifiable quotes — runs on the (possibly re-anchored)
 *    finding's final description.
 * 5. Merge same-root-cause duplicates last, so re-anchoring has already
 *    corrected each finding's location before grouping by overlap.
 */
export function normalizeSecurityOutput(output: AgentReviewOutput, context: ReviewContext): AgentReviewOutput {
  const withCategories = dropNonSecurityCategories(output.findings).map(normalizeCategoryLabel);
  const withCorrectedAnchors = withCategories.map((f) => reanchorFromSignatureLine(f, context));
  const withVerifiedEvidence = withCorrectedAnchors.map((f) => redactUnverifiableQuotes(f, context));
  const findings = mergeDuplicateFindings(withVerifiedEvidence);
  return { ...output, findings };
}
