import { categorySchema, type GroundTruthFinding } from "../schema";
import type { ClassifiedFinding, FixtureScore, ProducedFinding } from "../scorer";
import type { LoadedFixture } from "../load-fixtures";

/**
 * Task 5-equivalent failure-reason taxonomy for the Code Reviewer
 * benchmark — same design as `security-benchmarks/baseline/failure-analysis.ts`,
 * minus the evidence-state-specific reason (that machinery doesn't
 * exist in this benchmark's scorer — see `scorer.ts`'s own doc
 * comment for why). A fixture can carry more than one reason at once.
 */
export type FailureReason =
  | "missed defect"
  | "false positive"
  | "severity inflation"
  | "severity understatement"
  | "category mismatch"
  | "location mismatch"
  | "duplicate root cause"
  | "hallucination"
  | "fabricated evidence"
  | "overconfidence"
  | "benchmark compatibility limitation"
  | "provider/runtime failure";

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

function overlapsEntry(finding: ProducedFinding, entry: GroundTruthFinding): boolean {
  if (finding.file === null) return entry.repository_scope;
  if (!entry.files.includes(finding.file)) return false;
  const range = entry.line_ranges?.[finding.file];
  if (range === undefined || range === null) return true;
  if (finding.lineStart === null) return false;
  const producedEnd = finding.lineEnd ?? finding.lineStart;
  return finding.lineStart <= range[1] && range[0] <= producedEnd;
}

function findOverlappingEntry(finding: ProducedFinding, entries: readonly GroundTruthFinding[]): GroundTruthFinding | undefined {
  return entries.find((entry) => overlapsEntry(finding, entry));
}

function classifyLocationOverlapMiss(classified: ClassifiedFinding, allEntries: readonly GroundTruthFinding[]): FailureReason | null {
  const overlapping = findOverlappingEntry(classified.finding, allEntries);
  if (overlapping === undefined) {
    return classified.classification === "unsupported_extra" ? "location mismatch" : null;
  }

  if (!entriesNeedingDisambiguation(allEntries).has(overlapping.id)) return null;

  const rawIsCanonical = categorySchema.safeParse(classified.finding.category).success;
  const isGenericCompat = classified.normalizedCategory?.endsWith(".generic") ?? false;
  if ((classified.normalizedCategory === undefined && !rawIsCanonical) || isGenericCompat) {
    return "benchmark compatibility limitation";
  }
  return "category mismatch";
}

export function analyzeFixtureFailure(fixture: LoadedFixture, score: FixtureScore): FailureReason[] {
  const reasons = new Set<FailureReason>();

  if (score.requiredFindingsMissed.length > 0) reasons.add("missed defect");
  if (score.prohibitedFindings.length > 0 || score.falsePositives.length > 0) reasons.add("false positive");
  if (score.severityAccuracy.inflated > 0) reasons.add("severity inflation");
  if (score.severityAccuracy.understated > 0) reasons.add("severity understatement");
  if (score.duplicates.length > 0) reasons.add("duplicate root cause");
  if (score.hallucinatedPaths.length > 0) reasons.add("hallucination");
  if (score.fabricatedEvidence.length > 0) reasons.add("fabricated evidence");

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
