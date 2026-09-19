import type { Finding, ReviewerRun } from "@/domain/types";
import { checkRequiredReviewers, minimumVerdictFor } from "@/domain/verdict";
import type { ExpectedJudgeFixture, FixtureVerdict } from "./schema";

/**
 * Independent scoring harness for the Release Judge benchmark.
 *
 * Deliberately much smaller than the five specialist reviewers'
 * `scorer.ts` files: there is exactly one categorical output
 * (`verdict`) and one prose output (`summary`) to grade per fixture,
 * not an open-ended list of findings to location-match against ground
 * truth. See `schema.ts`'s header comment for the full rationale.
 *
 * Reuses `@/domain/verdict`'s `minimumVerdictFor`/`checkRequiredReviewers`
 * directly rather than reimplementing them, unlike the specialist
 * benchmarks' convention of copying small pieces of production
 * geometry independently. That convention exists so a benchmark never
 * silently drifts when a REVIEWER's tuned normalization logic changes;
 * `domain/verdict.ts`'s deterministic floor is explicitly the opposite
 * — the constraint for this task is "do not modify it", i.e. it is
 * treated as a fixed specification, not tunable reviewer behavior. Re-
 * deriving that specification by hand here would only risk the
 * benchmark's own copy silently diverging from the real one it exists
 * to check the judge against.
 */

const STRICTNESS: Record<FixtureVerdict, number> = { APPROVE: 0, APPROVE_WITH_MINOR_FIXES: 1, DO_NOT_APPROVE: 2 };
const stricter = (a: FixtureVerdict, b: FixtureVerdict): boolean => STRICTNESS[a] > STRICTNESS[b];

export interface RationaleGroundingIssue {
  kind: "false_no_issues_claim" | "unwarranted_critical_claim" | "missed_critical_claim";
  detail: string;
}

export interface JudgeFixtureScore {
  fixtureId: string;
  actualVerdict: FixtureVerdict;
  expectedVerdict: FixtureVerdict;
  deterministicFloor: FixtureVerdict;
  verdictCorrect: boolean;

  isBlockingFixture: boolean;
  missedBlocker: boolean;
  falseBlock: boolean;

  /** True when the RAW judge verdict is less strict than the deterministic floor — production's `applyVerdictFloor` would silently correct this before a user ever sees it, but it still indicates the judge's own reasoning under-shot policy. */
  floorViolation: boolean;

  isDuplicateFixture: boolean;
  duplicateInflation: boolean;

  isAmbiguousFixture: boolean;
  lowConfidenceOverescalation: boolean;

  requiredReviewerCoverageComplete: boolean;
  /** null when coverage is complete (not applicable); otherwise whether the judge's OWN raw verdict also refused to approve despite never having been told coverage was incomplete via any structured flag — informational only, since production never invokes the judge in this situation (see `ReviewOrchestrator.run`'s fail-closed check, which runs first). */
  judgeAlsoRecognizedGap: boolean | null;
  /**
   * False for a fixture the orchestrator would never actually let the
   * judge decide (incomplete required-reviewer coverage) — such a
   * fixture is an informational/adversarial RAW-JUDGE PROBE, since
   * `checkRequiredReviewers` (unmodified, `@/domain/verdict`) blocks
   * before the judge is ever consulted in real usage. Every
   * "production-facing" aggregate metric in `SuiteMetrics` — blocking-
   * defect recall, missed-blocker rate, false-block rate, verdict
   * accuracy — excludes a fixture where this is false from its
   * denominator, since scoring the raw judge's unsupervised guess
   * against what deterministic orchestration policy actually guarantees
   * would be comparing the wrong thing.
   */
  countsTowardProductionFacingMetrics: boolean;

  hallucinatedTerms: string[];
  groundingIssues: RationaleGroundingIssue[];

  passed: boolean;
}

/** Severity-specific language a summary might use to reference a finding of that severity, independent of any per-reviewer "no issues" phrasing elsewhere in the same summary. */
const SEVERITY_MENTION_PATTERN: Record<Finding["severity"], RegExp> = {
  P0: /\bp0\b|\bcritical\b/i,
  P1: /\bp1\b|\bhigh[- ]priority\b/i,
  P2: /\bp2\b|\bimprovement\b/i,
  NIT: /\bnit\b/i,
};

/**
 * A negation marker close enough before a matched term that the term is
 * being DENIED, not asserted — "no P0 findings", "not a critical issue",
 * "none of the P0/P1 blockers were confirmed". Fixed during this pass
 * after the tuned judge's own summaries (which now state severity
 * levels explicitly far more often, per its new grounding instruction)
 * exposed that the scorer's hallucination/critical-claim checks matched
 * a bare term with no regard for a preceding negation at all.
 */
const NEGATION_PRECEDING_PATTERN = /\b(?:no|not|none|zero|never|n\/a|without any)\b/i;

/**
 * Whether `term` appears in `lowerText` at least once WITHOUT a
 * negation marker in the `windowChars` immediately before that
 * occurrence — i.e. at least one occurrence is a genuine POSITIVE
 * assertion, not a denial. Scans every occurrence individually (not
 * just the first): a term that appears once negated and once asserted
 * still correctly counts as an ungrounded positive claim from the
 * second occurrence, so this can never be tricked by prefixing an
 * unrelated negated mention earlier in the same summary.
 */
function hasUngroundedPositiveMention(lowerText: string, term: string, windowChars = 40): boolean {
  const termLower = term.toLowerCase();
  let searchFrom = 0;
  for (;;) {
    const index = lowerText.indexOf(termLower, searchFrom);
    if (index === -1) return false;
    const preceding = lowerText.slice(Math.max(0, index - windowChars), index);
    if (!NEGATION_PRECEDING_PATTERN.test(preceding)) return true;
    searchFrom = index + termLower.length;
  }
}

/** Words too generic to count as evidence a summary is describing a SPECIFIC finding's own content (vs. incidental overlap with everyday phrasing). */
const GENERIC_WORD_STOPLIST = new Set([
  "should", "before", "issue", "concern", "concerns", "finding", "findings", "reviewer", "reviewers",
  "release", "shortly", "merge", "resolved", "verify", "verified", "confirm", "confirmed", "shipping",
  "severe", "which", "there", "these", "other", "found", "flagged", "single", "block",
]);

/** A finding's own title, reduced to the specific (non-generic, length >= 5) words a summary would have to reuse to be describing THIS finding's actual content rather than boilerplate. */
function significantTitleWords(title: string): string[] {
  return title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 5 && !GENERIC_WORD_STOPLIST.has(word));
}

/** Best-effort, heuristic textual grounding checks on the judge's freeform `summary` — the judge's output schema has no structured "which findings did you use" field, so this is necessarily approximate, exactly like the specialist benchmarks' fabrication-evidence heuristics are approximate. Never used to penalize a summary for what it DOESN'T say, only for concrete, checkable false claims.
 *
 * All three signals below were widened across two live-run fix cycles
 * during Phase 4 root-cause analysis of the first two real baseline
 * runs, after inspecting actual judge summaries this scorer had wrongly
 * flagged (see `docs/agents/release-judge-baseline-current.md`'s Phase
 * 5 section for the specific summaries): (1) a summary routinely and
 * correctly says "reviewers X, Y, Z found no issues" about the SUBSET
 * that actually found nothing, while still accurately describing the
 * one reviewer that did — the original regex fired on that "no issues"
 * substring with no regard for the rest of the sentence; (2) "this is a
 * critical vulnerability" is normal, accurate English for a severe P1
 * security finding, not a claim that it is literally labeled P0; (3) a
 * summary can accurately describe a finding's actual substance (e.g.
 * "a potential circular dependency between plans.ts and usage.ts")
 * without ever repeating the numeric severity label at all — checking
 * only for severity vocabulary ("P1"/"high-priority") missed this
 * entirely, so grounding is now ALSO satisfied by the summary reusing a
 * specific, non-generic word from the finding's own title.
 */
function detectGroundingIssues(summary: string, findings: readonly Finding[]): RationaleGroundingIssue[] {
  const issues: RationaleGroundingIssue[] = [];
  const lower = summary.toLowerCase();
  const hasP0 = findings.some((f) => f.severity === "P0");
  const hasP0OrP1 = findings.some((f) => f.severity === "P0" || f.severity === "P1");
  const hasAnyFinding = findings.length > 0;
  const mentionsAnyActualFinding = findings.some(
    (f) => SEVERITY_MENTION_PATTERN[f.severity].test(lower) || significantTitleWords(f.title).some((word) => new RegExp(`\\b${word}\\b`, "i").test(lower)),
  );

  const claimsNoIssues = /\bno (?:issues|findings|problems)\b|\blooks safe to ship\b|\bnothing (?:to flag|of concern)\b/.test(lower);
  if (hasAnyFinding && claimsNoIssues && !mentionsAnyActualFinding) {
    issues.push({ kind: "false_no_issues_claim", detail: "summary claims no issues/looks safe and never otherwise references any actual finding's severity or content" });
  }

  if (!hasP0OrP1 && (hasUngroundedPositiveMention(lower, "critical") || hasUngroundedPositiveMention(lower, "p0"))) {
    issues.push({ kind: "unwarranted_critical_claim", detail: "summary asserts (not merely negates) critical/P0 language despite no P0 or P1 finding being present" });
  }

  if (hasP0 && !/\bcritical\b|\bp0\b/.test(lower)) {
    issues.push({ kind: "missed_critical_claim", detail: "a P0 finding is present but the summary never characterizes anything as critical" });
  }

  return issues;
}

export interface ScoreFixtureInput {
  manifest: ExpectedJudgeFixture;
  reviewerRuns: readonly ReviewerRun[];
  actualVerdict: FixtureVerdict;
  actualSummary: string;
}

export function scoreFixture(input: ScoreFixtureInput): JudgeFixtureScore {
  const { manifest, reviewerRuns, actualVerdict, actualSummary } = input;
  const allFindings = reviewerRuns.flatMap((run) => run.findings);
  const expectedVerdict = manifest.expected.verdict;
  const deterministicFloor = minimumVerdictFor(allFindings);

  const isBlockingFixture = expectedVerdict === "DO_NOT_APPROVE";
  const missedBlocker = isBlockingFixture && actualVerdict !== "DO_NOT_APPROVE";
  const falseBlock = !isBlockingFixture && actualVerdict === "DO_NOT_APPROVE";
  const floorViolation = stricter(deterministicFloor, actualVerdict);

  const isDuplicateFixture = manifest.expected.duplicate_groups.length > 0;
  const duplicateInflation = isDuplicateFixture && stricter(actualVerdict, expectedVerdict);

  const isAmbiguousFixture = manifest.expected.low_confidence_only_finding_ids.length > 0;
  const lowConfidenceOverescalation = isAmbiguousFixture && stricter(actualVerdict, expectedVerdict);

  const coverageCheck = checkRequiredReviewers(reviewerRuns);
  const requiredReviewerCoverageComplete = !coverageCheck.blocked;
  const judgeAlsoRecognizedGap = requiredReviewerCoverageComplete ? null : actualVerdict === "DO_NOT_APPROVE";
  const countsTowardProductionFacingMetrics = requiredReviewerCoverageComplete;

  const hallucinatedTerms = manifest.expected.hallucination_probe_terms.filter((term) => hasUngroundedPositiveMention(actualSummary.toLowerCase(), term));
  const groundingIssues = detectGroundingIssues(actualSummary, allFindings);

  const verdictCorrect = actualVerdict === expectedVerdict;
  const passed =
    verdictCorrect &&
    !floorViolation &&
    !duplicateInflation &&
    !lowConfidenceOverescalation &&
    hallucinatedTerms.length === 0 &&
    groundingIssues.length === 0 &&
    (judgeAlsoRecognizedGap === null || judgeAlsoRecognizedGap);

  return {
    fixtureId: manifest.fixture_id,
    actualVerdict,
    expectedVerdict,
    deterministicFloor,
    verdictCorrect,
    isBlockingFixture,
    missedBlocker,
    falseBlock,
    floorViolation,
    isDuplicateFixture,
    duplicateInflation,
    isAmbiguousFixture,
    lowConfidenceOverescalation,
    requiredReviewerCoverageComplete,
    judgeAlsoRecognizedGap,
    countsTowardProductionFacingMetrics,
    hallucinatedTerms,
    groundingIssues,
    passed,
  };
}

export interface SuiteMetrics {
  fixturesRun: number;
  /** How many of `fixturesRun` count toward every "production-facing" metric below — i.e. exclude a raw-judge-only probe fixture like `failed-reviewer-01` (see `countsTowardProductionFacingMetrics`). */
  productionFacingFixturesRun: number;
  fixturesPassed: number;
  /** Production-facing: computed only over fixtures the orchestrator would actually let the judge decide. */
  verdictAccuracy: number;
  /** Production-facing. */
  blockingDefectRecall: number;
  /** Production-facing. */
  falseBlockRate: number;
  /** Production-facing. */
  missedBlockerRate: number;
  duplicateRiskInflationRate: number;
  lowConfidenceOverescalationRate: number;
  /**
   * RAW-JUDGE-ONLY — explicitly NOT production-facing. Measures whether
   * the judge, called directly and adversarially with incomplete
   * required-reviewer coverage (something production's unmodified
   * `checkRequiredReviewers` gate never actually allows), independently
   * also refused to approve. Production's real failed-reviewer handling
   * is guaranteed deterministically regardless of this number — see
   * `ReviewOrchestrator.run`'s fail-closed check.
   */
  rawJudgeFailedReviewerHandlingRate: number;
  severityFloorComplianceRate: number;
  rationaleGroundingAccuracy: number;
  hallucinatedFindingRate: number;
}

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

export function aggregateScores(scores: readonly JudgeFixtureScore[]): SuiteMetrics {
  const productionFacing = scores.filter((s) => s.countsTowardProductionFacingMetrics);
  const blockingFixtures = productionFacing.filter((s) => s.isBlockingFixture);
  const nonBlockingFixtures = productionFacing.filter((s) => !s.isBlockingFixture);
  const duplicateFixtures = scores.filter((s) => s.isDuplicateFixture);
  const ambiguousFixtures = scores.filter((s) => s.isAmbiguousFixture);
  const incompleteCoverageFixtures = scores.filter((s) => s.judgeAlsoRecognizedGap !== null);

  return {
    fixturesRun: scores.length,
    productionFacingFixturesRun: productionFacing.length,
    fixturesPassed: scores.filter((s) => s.passed).length,
    verdictAccuracy: rate(productionFacing.filter((s) => s.verdictCorrect).length, productionFacing.length),
    blockingDefectRecall: rate(blockingFixtures.filter((s) => !s.missedBlocker).length, blockingFixtures.length),
    falseBlockRate: rate(nonBlockingFixtures.filter((s) => s.falseBlock).length, nonBlockingFixtures.length),
    missedBlockerRate: rate(blockingFixtures.filter((s) => s.missedBlocker).length, blockingFixtures.length),
    duplicateRiskInflationRate: rate(duplicateFixtures.filter((s) => s.duplicateInflation).length, duplicateFixtures.length),
    lowConfidenceOverescalationRate: rate(ambiguousFixtures.filter((s) => s.lowConfidenceOverescalation).length, ambiguousFixtures.length),
    rawJudgeFailedReviewerHandlingRate: rate(incompleteCoverageFixtures.filter((s) => s.judgeAlsoRecognizedGap).length, incompleteCoverageFixtures.length),
    severityFloorComplianceRate: rate(scores.filter((s) => !s.floorViolation).length, scores.length),
    rationaleGroundingAccuracy: rate(scores.filter((s) => s.groundingIssues.length === 0).length, scores.length),
    hallucinatedFindingRate: rate(scores.filter((s) => s.hallucinatedTerms.length > 0).length, scores.length),
  };
}
