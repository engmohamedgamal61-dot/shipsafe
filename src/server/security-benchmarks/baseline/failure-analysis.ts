import { categorySchema, type GroundTruthFinding } from "../schema";
import type { ClassifiedFinding, FixtureScore, ProducedFinding } from "../scorer";
import type { LoadedFixture } from "../load-fixtures";

/**
 * Task 5's required failure-reason taxonomy, verbatim. A fixture can
 * carry more than one reason at once (e.g. a missed P0 alongside an
 * unrelated false positive) — `analyzeFixtureFailure` returns every
 * reason that applies, never picks just one.
 */
export type FailureReason =
  | "missed vulnerability"
  | "false positive"
  | "severity inflation"
  | "severity understatement"
  | "category mismatch"
  | "location mismatch"
  | "duplicate root cause"
  | "hallucination"
  | "fabricated evidence"
  | "overconfidence"
  | "insufficient evidence"
  | "benchmark compatibility limitation"
  | "provider/runtime failure";

/**
 * Diagnostic-only mirror of `scorer.ts`'s `findEntriesNeedingDisambiguation`
 * (not exported from there, and this module must not reach into scorer
 * internals) — same overlap geometry, used here purely to explain a
 * classification after the fact, never to reproduce or influence
 * scoring itself.
 */
function entriesNeedingDisambiguation(entries: readonly GroundTruthFinding[]): ReadonlySet<string> {
  const needs = new Set<string>();
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
        needs.add(a.id);
        needs.add(b.id);
      }
    }
  }
  return needs;
}

/** Whether `finding`'s file/line falls within `entry`'s declared region — category-blind, on purpose (this is diagnosing WHY a match failed, not deciding whether one should have succeeded). */
function overlapsEntry(finding: ProducedFinding, entry: GroundTruthFinding): boolean {
  if (finding.file === null) return entry.repository_scope;
  if (!entry.files.includes(finding.file)) return false;
  const range = entry.line_ranges?.[finding.file];
  if (range === undefined || range === null) return true;
  if (finding.lineStart === null) return false;
  const producedEnd = finding.lineEnd ?? finding.lineStart;
  return finding.lineStart <= range[1] && range[0] <= producedEnd;
}

function findOverlappingEntry(
  finding: ProducedFinding,
  entries: readonly GroundTruthFinding[],
): GroundTruthFinding | undefined {
  return entries.find((entry) => overlapsEntry(finding, entry));
}

/**
 * Explains a `prohibited`/`unsupported_extra` finding that landed at
 * (or near) a real ground-truth location but still didn't score as a
 * match — distinguishing a genuine reviewer category mistake from a
 * benchmark-side compatibility-layer limitation (plan §3.6): a
 * `.generic` compatibility mapping, or no mapping at all for an
 * unrecognized legacy string, can never disambiguate two overlapping
 * ground-truth entries BY DESIGN — that is the benchmark's own
 * deliberate conservatism, not evidence the reviewer pointed at the
 * wrong root cause.
 */
function classifyLocationOverlapMiss(classified: ClassifiedFinding, allEntries: readonly GroundTruthFinding[]): FailureReason | null {
  const overlapping = findOverlappingEntry(classified.finding, allEntries);
  if (overlapping === undefined) {
    // No real ground-truth entry anywhere near this claim.
    return classified.classification === "unsupported_extra" ? "location mismatch" : null;
  }

  // If this entry didn't actually need disambiguation from a sibling,
  // `scorer.ts`'s own matching would have matched on location ALONE
  // regardless of category — so reaching prohibited/unsupported_extra
  // while overlapping such an entry cannot be a category problem (it's
  // already explained by whatever other reason flagged it, e.g.
  // overconfidence on an ambiguous fixture, or a safe-fixture false
  // positive).
  if (!entriesNeedingDisambiguation(allEntries).has(overlapping.id)) return null;

  const rawIsCanonical = categorySchema.safeParse(classified.finding.category).success;
  const isGenericCompat = classified.normalizedCategory?.endsWith(".generic") ?? false;
  if ((classified.normalizedCategory === undefined && !rawIsCanonical) || isGenericCompat) {
    return "benchmark compatibility limitation";
  }
  return "category mismatch";
}

/**
 * Every applicable Task 5 failure reason for one already-scored fixture.
 * Pure and deterministic — reads only `FixtureScore` and the fixture's
 * own ground truth, never calls a model. `"provider/runtime failure"` is
 * NOT produced by this function (there is no `FixtureScore` at all when
 * the provider call itself failed) — callers add that reason directly
 * for a fixture whose run never reached scoring.
 */
export function analyzeFixtureFailure(fixture: LoadedFixture, score: FixtureScore): FailureReason[] {
  const reasons = new Set<FailureReason>();

  if (score.requiredFindingsMissed.length > 0) reasons.add("missed vulnerability");
  // Both classifications are "the reviewer asserted something the
  // fixture says is wrong" — `prohibited` (explicitly forbidden
  // category, a safe-fixture violation, or ambiguous overconfidence)
  // and `unsupported_extra` (a plausible-domain but unconfirmed claim)
  // are both false positives in Task 5's broader sense; they remain
  // separately inspectable via `score.prohibitedFindings`/
  // `score.falsePositives` for anyone who needs the finer distinction.
  if (score.prohibitedFindings.length > 0 || score.falsePositives.length > 0) reasons.add("false positive");
  if (score.severityAccuracy.inflated > 0) reasons.add("severity inflation");
  if (score.severityAccuracy.understated > 0) reasons.add("severity understatement");
  if (score.duplicates.length > 0) reasons.add("duplicate root cause");
  if (score.hallucinatedPaths.length > 0) reasons.add("hallucination");
  if (score.fabricatedEvidence.length > 0) reasons.add("fabricated evidence");
  if (score.insufficientEvidenceFindings.length > 0) reasons.add("insufficient evidence");

  const isAmbiguous = fixture.manifest.tags.includes("ambiguous");
  if (isAmbiguous && score.prohibitedFindings.some((c) => c.finding.confidence !== "low")) {
    reasons.add("overconfidence");
  }

  const allEntries = [...fixture.manifest.expected.required_findings, ...fixture.manifest.expected.optional_findings];
  for (const classified of [...score.prohibitedFindings, ...score.falsePositives]) {
    const reason = classifyLocationOverlapMiss(classified, allEntries);
    if (reason) reasons.add(reason);
  }

  return [...reasons];
}
