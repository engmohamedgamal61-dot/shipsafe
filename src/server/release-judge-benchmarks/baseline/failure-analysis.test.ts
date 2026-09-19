import { describe, expect, it } from "vitest";
import type { JudgeFixtureScore } from "../scorer";
import { analyzeFixtureFailure } from "./failure-analysis";

function score(overrides: Partial<JudgeFixtureScore> = {}): JudgeFixtureScore {
  return {
    fixtureId: "f1",
    actualVerdict: "APPROVE",
    expectedVerdict: "APPROVE",
    deterministicFloor: "APPROVE",
    verdictCorrect: true,
    isBlockingFixture: false,
    missedBlocker: false,
    falseBlock: false,
    floorViolation: false,
    isDuplicateFixture: false,
    duplicateInflation: false,
    isAmbiguousFixture: false,
    lowConfidenceOverescalation: false,
    requiredReviewerCoverageComplete: true,
    judgeAlsoRecognizedGap: null,
    countsTowardProductionFacingMetrics: true,
    hallucinatedTerms: [],
    groundingIssues: [],
    passed: true,
    ...overrides,
  };
}

describe("analyzeFixtureFailure", () => {
  it("returns no symptoms for a clean pass", () => {
    expect(analyzeFixtureFailure(score())).toEqual([]);
  });

  it("names every symptom present on the score", () => {
    const symptoms = analyzeFixtureFailure(
      score({
        missedBlocker: true,
        floorViolation: true,
        duplicateInflation: true,
        lowConfidenceOverescalation: true,
        judgeAlsoRecognizedGap: false,
        hallucinatedTerms: ["sql injection"],
        groundingIssues: [{ kind: "false_no_issues_claim", detail: "d" }],
      }),
    );
    expect(symptoms).toContain("missed blocker");
    expect(symptoms).toContain("floor violation");
    expect(symptoms).toContain("duplicate-risk inflation");
    expect(symptoms).toContain("low-confidence over-escalation");
    expect(symptoms).toContain("failed-reviewer gap not recognized by judge");
    expect(symptoms).toContain("hallucinated finding");
    expect(symptoms).toContain("rationale grounding issue");
  });

  it("flags a false block distinctly from a missed blocker", () => {
    expect(analyzeFixtureFailure(score({ falseBlock: true }))).toEqual(["false block"]);
  });
});
