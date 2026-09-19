import type { JudgeFixtureScore } from "../scorer";

/**
 * Symptom taxonomy for a scored Release Judge fixture — same role as
 * the five specialist reviewers' `baseline/failure-analysis.ts`: names
 * WHAT went wrong on a fixture, not WHY (root-cause classification
 * into true-judge-defect / benchmark-defect / ambiguous-ground-truth /
 * model-sampling-variance / infrastructure-failure /
 * deterministic-orchestrator-interaction is a human judgment call made
 * in the baseline report's prose, exactly as it was for the five
 * reviewers, never automated here).
 */
export type FailureSymptom =
  | "missed blocker"
  | "false block"
  | "floor violation"
  | "duplicate-risk inflation"
  | "low-confidence over-escalation"
  | "failed-reviewer gap not recognized by judge"
  | "hallucinated finding"
  | "rationale grounding issue"
  | "provider/runtime failure";

export function analyzeFixtureFailure(score: JudgeFixtureScore): FailureSymptom[] {
  const symptoms: FailureSymptom[] = [];
  if (score.missedBlocker) symptoms.push("missed blocker");
  if (score.falseBlock) symptoms.push("false block");
  if (score.floorViolation) symptoms.push("floor violation");
  if (score.duplicateInflation) symptoms.push("duplicate-risk inflation");
  if (score.lowConfidenceOverescalation) symptoms.push("low-confidence over-escalation");
  if (score.judgeAlsoRecognizedGap === false) symptoms.push("failed-reviewer gap not recognized by judge");
  if (score.hallucinatedTerms.length > 0) symptoms.push("hallucinated finding");
  if (score.groundingIssues.length > 0) symptoms.push("rationale grounding issue");
  return symptoms;
}
