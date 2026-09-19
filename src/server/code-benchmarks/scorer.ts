import { z } from "zod";
import { normalizeCategory } from "./category-compat";
import type { LoadedFixture } from "./load-fixtures";
import {
  CONFIDENCE_RANK,
  SEVERITY_RANK,
  confidenceSchema,
  severitySchema,
  type Confidence,
  type ExpectedFixture,
  type FixtureTag,
  type GroundTruthFinding,
  type Severity,
} from "./schema";

/**
 * Deterministic Code Reviewer benchmark scorer. Architecturally mirrors
 * `security-benchmarks/scorer.ts` (same classification model, same
 * fabrication-detection design, including the case-insensitivity and
 * illustrative-example/dotted-API-reference exemptions learned from
 * that benchmark's own real production runs — carrying forward FIXED
 * evidence-verification logic, not the original naive version, per
 * "do not weaken evidence verification") — but an independent module,
 * scoring an independent category taxonomy. Never imported by
 * `src/server/review-engine/` or by `security-benchmarks/`.
 *
 * Deliberately DOES NOT carry over the security benchmark's
 * `evidenceState`/`insufficient_evidence` machinery — not part of this
 * benchmark's requested metric set, and adding it here without a
 * requesting use case would be unrequested scope, not parity.
 */

export const producedFindingSchema = z
  .object({
    category: z.string().min(1),
    severity: severitySchema,
    confidence: confidenceSchema,
    file: z.string().min(1).nullable(),
    lineStart: z.number().int().positive().nullable(),
    lineEnd: z.number().int().positive().nullable(),
    evidence: z.string(),
    ruleId: z.string().min(1).optional(),
  })
  .refine((finding) => finding.lineStart !== null || finding.lineEnd === null, {
    message: "lineEnd must be null when lineStart is null",
    path: ["lineEnd"],
  })
  .refine((finding) => finding.lineStart === null || finding.lineEnd === null || finding.lineStart <= finding.lineEnd, {
    message: "lineStart must be <= lineEnd",
    path: ["lineEnd"],
  })
  .refine((finding) => finding.file !== null || finding.lineStart === null, {
    message: "lineStart must be null when file is null",
    path: ["lineStart"],
  });
export type ProducedFinding = z.infer<typeof producedFindingSchema>;

export const reviewerResultSchema = z.object({
  needsMoreContext: z.boolean().default(false),
  findings: z.array(producedFindingSchema).default([]),
});
export type ReviewerResult = z.infer<typeof reviewerResultSchema>;

export type FindingClassification =
  | "matched_required"
  | "matched_optional"
  | "duplicate"
  | "prohibited"
  | "unsupported_extra"
  | "hallucinated_path"
  | "fabricated_evidence";

export type MatchMethod = "rule_id" | "canonical_category_location" | "compatibility_category_location" | "unmatched";

export interface ClassifiedFinding {
  finding: ProducedFinding;
  index: number;
  classification: FindingClassification;
  matchedId: string | null;
  speculative: boolean;
  matchMethod: MatchMethod;
  normalizedCategory: string | undefined;
  compatibilityApplied: boolean;
  /** Whether the matched/attempted category (raw or normalized) equals one of the matched entry's OWN specific category set ({category, ...alternate_categories}) — distinct from whether MATCHING succeeded (location-only matching can succeed without this being true when no disambiguation is needed). Undefined when there was no entry to compare against (prohibited/unsupported_extra/hallucinated/fabricated). Feeds the "category accuracy" suite metric. */
  categoryAccurate: boolean | undefined;
}

function severityRangeIncludes(range: readonly [Severity, Severity], severity: Severity): boolean {
  const rank = SEVERITY_RANK[severity];
  return SEVERITY_RANK[range[0]] <= rank && rank <= SEVERITY_RANK[range[1]];
}

// ---------------------------------------------------------------------------
// Fabricated-evidence detection — same design as security-benchmarks/scorer.ts
// ---------------------------------------------------------------------------

const CODE_QUOTE_PATTERN = /`([^`]+)`/g;
const ILLUSTRATIVE_EXAMPLE_MARKER = /\b(?:e\.g\.,?|for example,?|such as|like)\s*$/i;
/**
 * A generic API/method reference, not a literal invocation:
 * - a dotted chain (`pg.Pool.query`), optionally with trailing `()`,
 * - OR a single leading-dot method reference (`.filter()`, `.includes()`)
 *   — the shorthand for "the X method" without naming a receiver, which
 *   is common, informal prose usage, confirmed as a real gap by this
 *   benchmark's own first live baseline run (a produced finding wrote
 *   `` `.filter()` `` generically, not as a claim that the literal text
 *   ".filter()" with empty parens appears in the diff).
 *
 * Deliberately requires EMPTY parens only (`\(\)`) — content inside
 * parens (real or fabricated arguments) is never covered by this
 * pattern at all, so a span like `` `reduce((a,b) => a+b, 0)` `` still
 * falls through to full verbatim verification, unexempted.
 */
const DOTTED_IDENTIFIER_PATTERN = /^\.?[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*(?:\(\))?$/;

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
  precedingContext: string;
}

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

function isIllustrativeExample(precedingContext: string): boolean {
  return ILLUSTRATIVE_EXAMPLE_MARKER.test(precedingContext);
}

function isVerifiableApiReference(span: string, sourceText: string): boolean {
  if (!DOTTED_IDENTIFIER_PATTERN.test(span)) return false;
  // Strip a trailing "()" (a bare method-name reference, never real
  // argument content — the pattern above only ever allows EMPTY parens)
  // and a leading "." (".filter()" names the method, not a receiver)
  // before splitting into per-segment identifiers to verify.
  const withoutCallParens = span.endsWith("()") ? span.slice(0, -2) : span;
  const segments = withoutCallParens.split(".").filter((segment) => segment.length > 0);
  return segments.every((segment) => new RegExp(`\\b${escapeForRegExp(segment)}\\b`).test(sourceText));
}

/**
 * Whether `finding.evidence` contains a deterministically-provable
 * fabrication. See `security-benchmarks/scorer.ts`'s identically-shaped
 * function for the full design rationale (case-insensitive comparison,
 * illustrative-example exemption, dotted-API-reference exemption) —
 * ported here verbatim in behavior since it's proven, general-purpose
 * evidence-verification logic, not anything security-specific.
 */
function hasFabricatedCodeClaim(finding: ProducedFinding, sourceText: string): boolean {
  const spans = extractQuotedCodeSpans(finding.evidence);
  if (spans.length === 0) return false;
  const normalizedSource = collapseWhitespace(sourceText).toLowerCase();
  return spans.some(({ span, precedingContext }) => {
    const candidate = stripTrailingPunctuation(span);
    if (candidate.length === 0) return false;
    if (normalizedSource.includes(candidate.toLowerCase())) return false;
    if (isIllustrativeExample(precedingContext)) return false;
    if (isVerifiableApiReference(candidate, sourceText)) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Category compatibility
// ---------------------------------------------------------------------------

function categoryMatchesEntry(findingCategory: string, entryCategory: string): boolean {
  if (findingCategory === entryCategory) return true;
  const normalized = normalizeCategory(findingCategory);
  return normalized !== undefined && normalized === entryCategory;
}

function categoryInSet(findingCategory: string, set: ReadonlySet<string>): boolean {
  if (set.has(findingCategory)) return true;
  const normalized = normalizeCategory(findingCategory);
  return normalized !== undefined && set.has(normalized);
}

// ---------------------------------------------------------------------------
// Location matching
// ---------------------------------------------------------------------------

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

  const acceptableCategories = [entry.category, ...(entry.alternate_categories ?? [])].filter((c): c is string => c !== undefined);
  if (acceptableCategories.length > 0 && needsDisambiguation.has(entry.id) && !acceptableCategories.some((c) => categoryCheck(finding.category, c))) {
    return false;
  }

  if (finding.file === null) return true;

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

  const canonicalCandidates = entries.filter((entry) => matchesByLocation(finding, entry, needsDisambiguation, (f, e) => f === e));
  const canonicalPick = pickFrom(canonicalCandidates);
  if (canonicalPick) return { entry: canonicalPick, method: "canonical_category_location" };

  const compatCandidates = entries.filter((entry) => matchesByLocation(finding, entry, needsDisambiguation, categoryMatchesEntry));
  const compatPick = pickFrom(compatCandidates);
  if (compatPick) return { entry: compatPick, method: "compatibility_category_location" };

  return undefined;
}

/** Whether `finding`'s category (raw or normalized) equals one of `entry`'s own specific category set — the "category accuracy" measure, independent of whether location-matching required it. */
function isCategoryAccurate(finding: ProducedFinding, entry: GroundTruthFinding): boolean {
  const acceptable = [entry.category, ...(entry.alternate_categories ?? [])].filter((c): c is string => c !== undefined);
  if (acceptable.length === 0) return true; // no expected category declared — nothing to be inaccurate about
  return acceptable.some((c) => categoryMatchesEntry(finding.category, c));
}

// ---------------------------------------------------------------------------
// Per-fixture scoring
// ---------------------------------------------------------------------------

export interface FixtureScore {
  fixtureId: string;
  domain: string;
  tags: FixtureTag[];
  passed: boolean;
  hardFailure: boolean;
  rawScore: number;
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
  allFindings: ClassifiedFinding[];
  severityAccuracy: { correct: number; inflated: number; understated: number };
  confidenceObservations: Array<{ confidence: Confidence; correct: boolean }>;
  requiredSeverityBreakdown: { p0Total: number; p0Matched: number; p1Total: number; p1Matched: number };
  /** Category-accuracy observations over matched_required findings only — see `isCategoryAccurate`. */
  categoryAccuracyObservations: boolean[];
}

function findEntry(entries: readonly GroundTruthFinding[], id: string): GroundTruthFinding {
  const entry = entries.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`internal scorer error: no ground-truth entry with id "${id}" — this should be unreachable`);
  return entry;
}

export function scoreFixture(fixture: LoadedFixture, result: ReviewerResult): FixtureScore {
  const manifest: ExpectedFixture = fixture.manifest;
  const knownFiles = new Set(manifest.files);
  const isAmbiguous = manifest.expected.needs_more_context_acceptable;
  const isSafe = manifest.tags.includes("safe") || manifest.tags.includes("false_positive_trap");
  const allowedCategories = new Set(manifest.expected.allowed_categories);
  const prohibitedCategories = new Set(manifest.expected.prohibited_categories);
  const needsDisambiguation = findEntriesNeedingDisambiguation([...manifest.expected.required_findings, ...manifest.expected.optional_findings]);
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
        categoryAccurate: undefined,
      });
      return;
    }

    const trimmedEvidence = finding.evidence.trim();
    if (trimmedEvidence.length > 0) {
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
          categoryAccurate: undefined,
        });
        return;
      }
    }
    const speculative = trimmedEvidence.length === 0;

    const ambiguousBlocksMatch = isAmbiguous && finding.confidence !== "low";

    const requiredMatch = ambiguousBlocksMatch ? undefined : pickMatch(manifest.expected.required_findings, new Set(requiredConsumedBy.keys()), finding, needsDisambiguation);
    if (requiredMatch) {
      const { entry, method } = requiredMatch;
      const compatibilityApplied = method === "compatibility_category_location";
      const categoryAccurate = isCategoryAccurate(finding, entry);
      if (requiredConsumedBy.has(entry.id)) {
        classified.push({ finding, index, classification: "duplicate", matchedId: entry.id, speculative, matchMethod: method, normalizedCategory, compatibilityApplied, categoryAccurate });
      } else {
        requiredConsumedBy.set(entry.id, index);
        classified.push({ finding, index, classification: "matched_required", matchedId: entry.id, speculative, matchMethod: method, normalizedCategory, compatibilityApplied, categoryAccurate });
      }
      return;
    }

    const optionalMatch = ambiguousBlocksMatch ? undefined : pickMatch(manifest.expected.optional_findings, new Set(optionalConsumedBy.keys()), finding, needsDisambiguation);
    if (optionalMatch) {
      const { entry, method } = optionalMatch;
      const compatibilityApplied = method === "compatibility_category_location";
      const categoryAccurate = isCategoryAccurate(finding, entry);
      if (optionalConsumedBy.has(entry.id)) {
        classified.push({ finding, index, classification: "duplicate", matchedId: entry.id, speculative, matchMethod: method, normalizedCategory, compatibilityApplied, categoryAccurate });
      } else {
        optionalConsumedBy.set(entry.id, index);
        classified.push({ finding, index, classification: "matched_optional", matchedId: entry.id, speculative, matchMethod: method, normalizedCategory, compatibilityApplied, categoryAccurate });
      }
      return;
    }

    const explicitlyProhibited = categoryInSet(finding.category, prohibitedCategories);
    const ambiguousOverconfidence = isAmbiguous && finding.confidence !== "low";
    const categoryAllowed = categoryInSet(finding.category, allowedCategories);
    const compatibilityApplied = (!prohibitedCategories.has(finding.category) && explicitlyProhibited) || (!allowedCategories.has(finding.category) && categoryAllowed);

    if (explicitlyProhibited || isSafe || ambiguousOverconfidence || !categoryAllowed) {
      classified.push({ finding, index, classification: "prohibited", matchedId: null, speculative, matchMethod: "unmatched", normalizedCategory, compatibilityApplied, categoryAccurate: undefined });
      return;
    }

    classified.push({ finding, index, classification: "unsupported_extra", matchedId: null, speculative, matchMethod: "unmatched", normalizedCategory, compatibilityApplied, categoryAccurate: undefined });
  });

  const requiredFindingsDetected = manifest.expected.required_findings.filter((entry) => requiredConsumedBy.has(entry.id)).map((entry) => entry.id);
  const requiredFindingsMissed = manifest.expected.required_findings.filter((entry) => !requiredConsumedBy.has(entry.id)).map((entry) => entry.id);
  const optionalFindingsAccepted = manifest.expected.optional_findings.filter((entry) => optionalConsumedBy.has(entry.id)).map((entry) => entry.id);

  const duplicates = classified.filter((c) => c.classification === "duplicate");
  const prohibitedFindings = classified.filter((c) => c.classification === "prohibited");
  const falsePositives = classified.filter((c) => c.classification === "unsupported_extra");
  const hallucinatedPaths = classified.filter((c) => c.classification === "hallucinated_path");
  const fabricatedEvidence = classified.filter((c) => c.classification === "fabricated_evidence");
  const speculativeFindings = classified.filter((c) => c.speculative && (c.classification === "matched_required" || c.classification === "matched_optional"));
  const categoryAccuracyObservations = classified.filter((c) => c.classification === "matched_required" && c.categoryAccurate !== undefined).map((c) => c.categoryAccurate as boolean);

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
    correct: c.classification === "matched_required" || c.classification === "matched_optional" || c.classification === "duplicate",
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
    if (requiredConsumedBy.has(entry.id)) rawScore += 1;
    else rawScore -= severityRangeIncludes(entry.severity_range, "P0") ? 2 : 1;
  }
  rawScore -= 0.3 * duplicates.length;
  rawScore -= (isSafe ? 2 : 1) * prohibitedFindings.length;
  rawScore -= 0.5 * falsePositives.length;
  rawScore -= 0.5 * speculativeFindings.length;
  rawScore -= 0.5 * severityInflated;
  rawScore -= 0.25 * severityUnderstated;

  const wouldPassIgnoringRequired = !hardFailure && prohibitedFindings.length === 0 && falsePositives.length === 0;
  if ((isSafe || isAmbiguous) && wouldPassIgnoringRequired) rawScore += 1;

  const maxPossible = manifest.expected.required_findings.length + (isSafe || isAmbiguous ? 1 : 0);
  const minPossible = -5;
  const normalizedScore = hardFailure ? 0 : Math.min(1, Math.max(0, (rawScore - minPossible) / (maxPossible - minPossible)));

  const passed = !hardFailure && requiredFindingsMissed.length === 0 && prohibitedFindings.length === 0 && falsePositives.length === 0;

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
    allFindings: classified,
    severityAccuracy: { correct: severityCorrect, inflated: severityInflated, understated: severityUnderstated },
    confidenceObservations,
    requiredSeverityBreakdown: { p0Total, p0Matched, p1Total, p1Matched },
    categoryAccuracyObservations,
  };
}

// ---------------------------------------------------------------------------
// Compatibility report
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
}

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
  fabricatedEvidenceRate: number;
  speculativeRate: number;
  duplicateRate: number;
  severityAccuracyRate: number;
  /** New for the Code Reviewer benchmark (not present in the security scorer): of matched_required findings, the fraction whose category (raw or normalized) equals one of the entry's own expected category set — vacuously 1 when no matched_required findings exist. */
  categoryAccuracyRate: number;
  confidenceCalibration: Record<Confidence, { total: number; correct: number; rate: number }>;
  byDomain: Record<string, number>;
  byTag: Record<string, number>;
  failedFixtures: string[];
}

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
  let severityCorrect = 0;
  let severityChecked = 0;
  let categoryAccurateCount = 0;
  let categoryAccuracyChecked = 0;
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
    severityCorrect += s.severityAccuracy.correct;
    severityChecked += s.severityAccuracy.correct + s.severityAccuracy.inflated + s.severityAccuracy.understated;
    categoryAccurateCount += s.categoryAccuracyObservations.filter(Boolean).length;
    categoryAccuracyChecked += s.categoryAccuracyObservations.length;

    for (const obs of s.confidenceObservations) {
      confidenceBuckets[obs.confidence].total += 1;
      if (obs.correct) confidenceBuckets[obs.confidence].correct += 1;
    }

    (byDomainScores[s.domain] ??= []).push(s.normalizedScore);
    for (const tag of s.tags) (byTagScores[tag] ??= []).push(s.normalizedScore);
    if (s.hardFailure) failedFixtures.push(s.fixtureId);
  }

  const totalMatched = totalRequiredMatched + totalOptionalMatched;
  const totalProducedFindings = totalMatched + totalDuplicates + totalProhibited + totalUnsupported + totalHallucinated + totalFabricated;
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
    },
    precision: safeDivide(totalMatched, totalProducedFindings, 1),
    recall: safeDivide(totalRequiredMatched, totalRequired, 1),
    p0Recall: safeDivide(p0Matched, p0Total, 1),
    p1Recall: safeDivide(p1Matched, p1Total, 1),
    falsePositiveRate: safeDivide(totalProhibited + totalUnsupported, totalProducedFindings, 0),
    hallucinationRate: safeDivide(totalHallucinated, totalProducedFindings, 0),
    fabricatedEvidenceRate: safeDivide(totalFabricated, totalProducedFindings, 0),
    speculativeRate: safeDivide(totalSpeculative, totalProducedFindings, 0),
    duplicateRate: safeDivide(totalDuplicates, totalProducedFindings, 0),
    severityAccuracyRate: safeDivide(severityCorrect, severityChecked, 1),
    categoryAccuracyRate: safeDivide(categoryAccurateCount, categoryAccuracyChecked, 1),
    confidenceCalibration: {
      high: { ...confidenceBuckets.high, rate: safeDivide(confidenceBuckets.high.correct, confidenceBuckets.high.total, 1) },
      medium: { ...confidenceBuckets.medium, rate: safeDivide(confidenceBuckets.medium.correct, confidenceBuckets.medium.total, 1) },
      low: { ...confidenceBuckets.low, rate: safeDivide(confidenceBuckets.low.correct, confidenceBuckets.low.total, 1) },
    },
    byDomain: Object.fromEntries(Object.entries(byDomainScores).map(([domain, values]) => [domain, average(values)])),
    byTag: Object.fromEntries(Object.entries(byTagScores).map(([tag, values]) => [tag, average(values)])),
    failedFixtures,
  };
}

export { CONFIDENCE_RANK, SEVERITY_RANK };
