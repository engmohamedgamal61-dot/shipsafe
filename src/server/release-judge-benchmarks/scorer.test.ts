import { describe, expect, it } from "vitest";
import type { Finding, ReviewerRun } from "@/domain/types";
import type { ExpectedJudgeFixture } from "./schema";
import { aggregateScores, scoreFixture } from "./scorer";

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "f1",
    reviewerRunId: "run-1",
    severity: "P1",
    title: "Finding",
    description: "d",
    filePath: null,
    lineStart: null,
    lineEnd: null,
    category: "c",
    recommendation: "r",
    confidence: 0.9,
    ...overrides,
  };
}

function run(overrides: Partial<ReviewerRun> = {}): ReviewerRun {
  return {
    id: "run-1",
    reviewId: "review-1",
    reviewer: "code",
    status: "complete",
    summary: "ok",
    errorMessage: null,
    providerMetadata: null,
    startedAt: null,
    completedAt: null,
    findings: [],
    ...overrides,
  };
}

function allRequiredRuns(overrides: Partial<Record<ReviewerRun["reviewer"], ReviewerRun>> = {}): ReviewerRun[] {
  const reviewers: ReviewerRun["reviewer"][] = ["code", "security", "architecture", "database", "test"];
  return reviewers.map((reviewer) => overrides[reviewer] ?? run({ id: `run-${reviewer}`, reviewer }));
}

function manifest(overrides: Partial<ExpectedJudgeFixture["expected"]> = {}): ExpectedJudgeFixture {
  return {
    fixture_id: "fixture-1",
    domain: "test",
    tags: ["clean"],
    description: "d",
    reviewer_runs: [],
    expected: {
      verdict: "APPROVE",
      rationale: "r",
      blocking_finding_ids: [],
      duplicate_groups: [],
      low_confidence_only_finding_ids: [],
      requires_full_reviewer_coverage: true,
      hallucination_probe_terms: [],
      ...overrides,
    },
  };
}

describe("scoreFixture — verdict accuracy", () => {
  it("passes when the actual verdict matches expected", () => {
    const score = scoreFixture({ manifest: manifest(), reviewerRuns: allRequiredRuns(), actualVerdict: "APPROVE", actualSummary: "No issues found." });
    expect(score.verdictCorrect).toBe(true);
    expect(score.passed).toBe(true);
  });

  it("fails when the actual verdict is more lenient than expected", () => {
    const score = scoreFixture({
      manifest: manifest({ verdict: "DO_NOT_APPROVE" }),
      reviewerRuns: allRequiredRuns(),
      actualVerdict: "APPROVE",
      actualSummary: "No issues found.",
    });
    expect(score.verdictCorrect).toBe(false);
    expect(score.missedBlocker).toBe(true);
  });
});

describe("scoreFixture — false block / missed blocker", () => {
  it("flags a false block when a non-blocking fixture gets DO_NOT_APPROVE", () => {
    const score = scoreFixture({ manifest: manifest({ verdict: "APPROVE" }), reviewerRuns: allRequiredRuns(), actualVerdict: "DO_NOT_APPROVE", actualSummary: "Blocked." });
    expect(score.falseBlock).toBe(true);
    expect(score.missedBlocker).toBe(false);
  });

  it("flags a missed blocker when a blocking fixture doesn't get DO_NOT_APPROVE", () => {
    const score = scoreFixture({
      manifest: manifest({ verdict: "DO_NOT_APPROVE" }),
      reviewerRuns: allRequiredRuns(),
      actualVerdict: "APPROVE_WITH_MINOR_FIXES",
      actualSummary: "Some issues.",
    });
    expect(score.missedBlocker).toBe(true);
    expect(score.falseBlock).toBe(false);
  });
});

describe("scoreFixture — deterministic floor", () => {
  it("computes the real deterministic floor from findings via @/domain/verdict, not a reimplementation", () => {
    const runs = allRequiredRuns({ security: run({ id: "run-security", reviewer: "security", findings: [finding({ severity: "P0" })] }) });
    const score = scoreFixture({ manifest: manifest({ verdict: "DO_NOT_APPROVE" }), reviewerRuns: runs, actualVerdict: "DO_NOT_APPROVE", actualSummary: "Blocked." });
    expect(score.deterministicFloor).toBe("DO_NOT_APPROVE");
  });

  it("flags a floor violation when the raw judge verdict is less strict than the deterministic floor", () => {
    const runs = allRequiredRuns({ security: run({ id: "run-security", reviewer: "security", findings: [finding({ severity: "P0" })] }) });
    const score = scoreFixture({ manifest: manifest({ verdict: "DO_NOT_APPROVE" }), reviewerRuns: runs, actualVerdict: "APPROVE", actualSummary: "No issues." });
    expect(score.floorViolation).toBe(true);
  });

  it("does not flag a floor violation when the judge is stricter than the floor", () => {
    const runs = allRequiredRuns({ database: run({ id: "run-database", reviewer: "database", findings: [finding({ severity: "P1" })] }) });
    const score = scoreFixture({
      manifest: manifest({ verdict: "DO_NOT_APPROVE" }),
      reviewerRuns: runs,
      actualVerdict: "DO_NOT_APPROVE",
      actualSummary: "Blocked due to high risk.",
    });
    expect(score.floorViolation).toBe(false);
  });
});

describe("scoreFixture — duplicate-risk inflation", () => {
  it("flags inflation when a duplicate-tagged fixture escalates beyond expected", () => {
    const runs = allRequiredRuns({
      code: run({ id: "run-code", reviewer: "code", findings: [finding({ id: "a", severity: "P1" })] }),
      database: run({ id: "run-database", reviewer: "database", findings: [finding({ id: "b", severity: "P1" })] }),
    });
    const score = scoreFixture({
      manifest: manifest({ verdict: "APPROVE_WITH_MINOR_FIXES", duplicate_groups: [["a", "b"]] }),
      reviewerRuns: runs,
      actualVerdict: "DO_NOT_APPROVE",
      actualSummary: "Two separate high-priority issues must be fixed.",
    });
    expect(score.duplicateInflation).toBe(true);
  });

  it("does not flag inflation when the verdict matches expected", () => {
    const runs = allRequiredRuns({
      code: run({ id: "run-code", reviewer: "code", findings: [finding({ id: "a", severity: "P1" })] }),
      database: run({ id: "run-database", reviewer: "database", findings: [finding({ id: "b", severity: "P1" })] }),
    });
    const score = scoreFixture({
      manifest: manifest({ verdict: "APPROVE_WITH_MINOR_FIXES", duplicate_groups: [["a", "b"]] }),
      reviewerRuns: runs,
      actualVerdict: "APPROVE_WITH_MINOR_FIXES",
      actualSummary: "One shared root cause across two reviewers.",
    });
    expect(score.duplicateInflation).toBe(false);
  });
});

describe("scoreFixture — low-confidence over-escalation", () => {
  it("flags over-escalation when a low-confidence-only fixture is blocked", () => {
    const runs = allRequiredRuns({ architecture: run({ id: "run-architecture", reviewer: "architecture", findings: [finding({ id: "a", confidence: 0.2 })] }) });
    const score = scoreFixture({
      manifest: manifest({ verdict: "APPROVE_WITH_MINOR_FIXES", low_confidence_only_finding_ids: ["a"] }),
      reviewerRuns: runs,
      actualVerdict: "DO_NOT_APPROVE",
      actualSummary: "Blocked.",
    });
    expect(score.lowConfidenceOverescalation).toBe(true);
  });
});

describe("scoreFixture — failed-reviewer coverage", () => {
  it("reports incomplete coverage and whether the judge itself also refused to approve", () => {
    const runs = allRequiredRuns({ test: run({ id: "run-test", reviewer: "test", status: "failed", findings: [] }) });
    const scoreRecognized = scoreFixture({ manifest: manifest({ verdict: "DO_NOT_APPROVE" }), reviewerRuns: runs, actualVerdict: "DO_NOT_APPROVE", actualSummary: "Blocked." });
    expect(scoreRecognized.requiredReviewerCoverageComplete).toBe(false);
    expect(scoreRecognized.judgeAlsoRecognizedGap).toBe(true);

    const scoreMissed = scoreFixture({ manifest: manifest({ verdict: "DO_NOT_APPROVE" }), reviewerRuns: runs, actualVerdict: "APPROVE", actualSummary: "Looks fine." });
    expect(scoreMissed.judgeAlsoRecognizedGap).toBe(false);
  });

  it("reports judgeAlsoRecognizedGap as null when coverage is complete", () => {
    const score = scoreFixture({ manifest: manifest(), reviewerRuns: allRequiredRuns(), actualVerdict: "APPROVE", actualSummary: "ok" });
    expect(score.judgeAlsoRecognizedGap).toBeNull();
  });
});

describe("scoreFixture — hallucination and grounding", () => {
  it("flags a hallucination-probe term found in the summary", () => {
    const score = scoreFixture({
      manifest: manifest({ hallucination_probe_terms: ["sql injection"] }),
      reviewerRuns: allRequiredRuns(),
      actualVerdict: "APPROVE",
      actualSummary: "No issues found, though watch for potential SQL injection risk.",
    });
    expect(score.hallucinatedTerms).toEqual(["sql injection"]);
    expect(score.passed).toBe(false);
  });

  it("flags a false 'no issues' claim when findings are actually present", () => {
    const runs = allRequiredRuns({ code: run({ id: "run-code", reviewer: "code", findings: [finding({ severity: "P2" })] }) });
    const score = scoreFixture({
      manifest: manifest({ verdict: "APPROVE_WITH_MINOR_FIXES" }),
      reviewerRuns: runs,
      actualVerdict: "APPROVE_WITH_MINOR_FIXES",
      actualSummary: "No issues found. Looks safe to ship.",
    });
    expect(score.groundingIssues.some((g) => g.kind === "false_no_issues_claim")).toBe(true);
  });

  it("flags an unwarranted critical claim when no P0 is present", () => {
    const score = scoreFixture({
      manifest: manifest({ verdict: "APPROVE_WITH_MINOR_FIXES" }),
      reviewerRuns: allRequiredRuns(),
      actualVerdict: "APPROVE_WITH_MINOR_FIXES",
      actualSummary: "There is a critical issue that must be fixed.",
    });
    expect(score.groundingIssues.some((g) => g.kind === "unwarranted_critical_claim")).toBe(true);
  });

  it("flags a missed critical claim when a P0 is present but never characterized as critical", () => {
    const runs = allRequiredRuns({ security: run({ id: "run-security", reviewer: "security", findings: [finding({ severity: "P0" })] }) });
    const score = scoreFixture({
      manifest: manifest({ verdict: "DO_NOT_APPROVE" }),
      reviewerRuns: runs,
      actualVerdict: "DO_NOT_APPROVE",
      actualSummary: "There is an issue that should be fixed before merging.",
    });
    expect(score.groundingIssues.some((g) => g.kind === "missed_critical_claim")).toBe(true);
  });

  it("does not flag a per-reviewer 'no issues' breakdown that also references the one real finding's severity", () => {
    const runs = allRequiredRuns({ database: run({ id: "run-database", reviewer: "database", findings: [finding({ severity: "P1" })] }) });
    const score = scoreFixture({
      manifest: manifest({ verdict: "APPROVE_WITH_MINOR_FIXES" }),
      reviewerRuns: runs,
      actualVerdict: "APPROVE_WITH_MINOR_FIXES",
      actualSummary: "Code, security, architecture, and test reviewers found no issues. However, the database reviewer flagged a P1 concern that should be addressed before or shortly after release.",
    });
    expect(score.groundingIssues.some((g) => g.kind === "false_no_issues_claim")).toBe(false);
  });

  it("does not flag calling a severe P1 'critical' in prose as an unwarranted critical claim", () => {
    const runs = allRequiredRuns({ security: run({ id: "run-security", reviewer: "security", findings: [finding({ severity: "P1" })] }) });
    const score = scoreFixture({
      manifest: manifest({ verdict: "DO_NOT_APPROVE" }),
      reviewerRuns: runs,
      actualVerdict: "DO_NOT_APPROVE",
      actualSummary: "The security reviewer identified a P1 issue. This is a critical vulnerability that must be fixed before release.",
    });
    expect(score.groundingIssues.some((g) => g.kind === "unwarranted_critical_claim")).toBe(false);
  });

  it("does not flag a summary that describes a finding's actual substance without repeating its severity label", () => {
    const runs = allRequiredRuns({
      architecture: run({ id: "run-architecture", reviewer: "architecture", findings: [finding({ id: "a", title: "Possible circular dependency between two modules", confidence: 0.2 })] }),
    });
    const score = scoreFixture({
      manifest: manifest({ verdict: "APPROVE_WITH_MINOR_FIXES", low_confidence_only_finding_ids: ["a"] }),
      reviewerRuns: runs,
      actualVerdict: "APPROVE_WITH_MINOR_FIXES",
      actualSummary: "Most reviewers found no issues. The architecture reviewer flagged a single low-confidence, unconfirmed potential circular dependency in the billing module.",
    });
    expect(score.groundingIssues.some((g) => g.kind === "false_no_issues_claim")).toBe(false);
  });

  it("still flags an unwarranted critical claim when no P0 or P1 finding exists at all", () => {
    const runs = allRequiredRuns({ code: run({ id: "run-code", reviewer: "code", findings: [finding({ severity: "P2" })] }) });
    const score = scoreFixture({
      manifest: manifest({ verdict: "APPROVE_WITH_MINOR_FIXES" }),
      reviewerRuns: runs,
      actualVerdict: "APPROVE_WITH_MINOR_FIXES",
      actualSummary: "There is a critical issue that must be fixed immediately.",
    });
    expect(score.groundingIssues.some((g) => g.kind === "unwarranted_critical_claim")).toBe(true);
  });

  it("has no grounding issues for an accurate, well-grounded summary", () => {
    const runs = allRequiredRuns({ security: run({ id: "run-security", reviewer: "security", findings: [finding({ severity: "P0" })] }) });
    const score = scoreFixture({
      manifest: manifest({ verdict: "DO_NOT_APPROVE" }),
      reviewerRuns: runs,
      actualVerdict: "DO_NOT_APPROVE",
      actualSummary: "A critical (P0) issue from the security reviewer must be resolved before this can merge.",
    });
    expect(score.groundingIssues).toEqual([]);
  });
});

describe("scoreFixture — negation-aware grounding and hallucination detection", () => {
  it("a negated severity claim ('no P0/P1 findings') is grounded, not hallucinated", () => {
    const score = scoreFixture({
      manifest: manifest({ verdict: "APPROVE_WITH_MINOR_FIXES", hallucination_probe_terms: ["P0"] }),
      reviewerRuns: allRequiredRuns({ code: run({ id: "run-code", reviewer: "code", findings: [finding({ severity: "P2" })] }) }),
      actualVerdict: "APPROVE_WITH_MINOR_FIXES",
      actualSummary: "One P2 finding from the code reviewer. No P0/P1 findings were identified, so no stricter verdict is warranted.",
    });
    expect(score.hallucinatedTerms).toEqual([]);
    expect(score.groundingIssues.some((g) => g.kind === "unwarranted_critical_claim")).toBe(false);
  });

  it("a negated security claim ('no security defects were identified') is grounded, not hallucinated", () => {
    const score = scoreFixture({
      manifest: manifest({ verdict: "APPROVE_WITH_MINOR_FIXES", hallucination_probe_terms: ["security"] }),
      reviewerRuns: allRequiredRuns({ code: run({ id: "run-code", reviewer: "code", findings: [finding({ severity: "P2" })] }) }),
      actualVerdict: "APPROVE_WITH_MINOR_FIXES",
      actualSummary: "One P2 finding from the code reviewer. No security defects were identified.",
    });
    expect(score.hallucinatedTerms).toEqual([]);
  });

  it("a positive invented P0 claim is still rejected as hallucinated", () => {
    const score = scoreFixture({
      manifest: manifest({ verdict: "APPROVE", hallucination_probe_terms: ["P0"] }),
      reviewerRuns: allRequiredRuns(),
      actualVerdict: "DO_NOT_APPROVE",
      actualSummary: "There is a P0 finding that must be fixed before release.",
    });
    expect(score.hallucinatedTerms).toEqual(["P0"]);
  });

  it("a positive invented security finding is still rejected as hallucinated", () => {
    const score = scoreFixture({
      manifest: manifest({ verdict: "APPROVE", hallucination_probe_terms: ["security"] }),
      reviewerRuns: allRequiredRuns(),
      actualVerdict: "DO_NOT_APPROVE",
      actualSummary: "A critical security defect exists and must be resolved.",
    });
    expect(score.hallucinatedTerms).toEqual(["security"]);
  });

  it("still flags an unwarranted critical claim that is genuinely asserted, not negated", () => {
    const score = scoreFixture({
      manifest: manifest({ verdict: "APPROVE_WITH_MINOR_FIXES" }),
      reviewerRuns: allRequiredRuns({ code: run({ id: "run-code", reviewer: "code", findings: [finding({ severity: "P2" })] }) }),
      actualVerdict: "APPROVE_WITH_MINOR_FIXES",
      actualSummary: "There is a critical issue that must be fixed immediately.",
    });
    expect(score.groundingIssues.some((g) => g.kind === "unwarranted_critical_claim")).toBe(true);
  });

  it("a term negated once but asserted a second time is still flagged (scans every occurrence)", () => {
    const score = scoreFixture({
      manifest: manifest({ verdict: "APPROVE", hallucination_probe_terms: ["P0"] }),
      reviewerRuns: allRequiredRuns(),
      actualVerdict: "DO_NOT_APPROVE",
      actualSummary: "No P0 findings were reported by any reviewer, but there is a P0 finding hidden in the architecture notes.",
    });
    expect(score.hallucinatedTerms).toEqual(["P0"]);
  });
});

describe("scoreFixture — production-facing vs. raw-judge-only accounting (failed-reviewer probe)", () => {
  it("marks a fixture with incomplete required-reviewer coverage as not counting toward production-facing metrics", () => {
    const runs = allRequiredRuns({ test: run({ id: "run-test", reviewer: "test", status: "failed", findings: [] }) });
    const score = scoreFixture({ manifest: manifest({ verdict: "DO_NOT_APPROVE" }), reviewerRuns: runs, actualVerdict: "APPROVE_WITH_MINOR_FIXES", actualSummary: "Looks fine." });
    expect(score.countsTowardProductionFacingMetrics).toBe(false);
    // The raw result is still recorded, informationally, even though it won't count toward production-facing aggregates.
    expect(score.missedBlocker).toBe(true);
    expect(score.verdictCorrect).toBe(false);
  });

  it("marks a fixture with complete required-reviewer coverage as counting toward production-facing metrics", () => {
    const score = scoreFixture({ manifest: manifest(), reviewerRuns: allRequiredRuns(), actualVerdict: "APPROVE", actualSummary: "ok" });
    expect(score.countsTowardProductionFacingMetrics).toBe(true);
  });
});

describe("aggregateScores", () => {
  it("computes suite-level rates across a mix of fixtures", () => {
    const clean = scoreFixture({ manifest: manifest(), reviewerRuns: allRequiredRuns(), actualVerdict: "APPROVE", actualSummary: "ok" });
    const blocking = scoreFixture({
      manifest: manifest({ verdict: "DO_NOT_APPROVE" }),
      reviewerRuns: allRequiredRuns({ security: run({ id: "run-security", reviewer: "security", findings: [finding({ severity: "P0" })] }) }),
      actualVerdict: "DO_NOT_APPROVE",
      actualSummary: "Critical issue found.",
    });
    const suite = aggregateScores([clean, blocking]);
    expect(suite.fixturesRun).toBe(2);
    expect(suite.fixturesPassed).toBe(2);
    expect(suite.verdictAccuracy).toBe(1);
    expect(suite.blockingDefectRecall).toBe(1);
  });

  it("excludes a raw-judge-only failed-reviewer probe from production-facing metrics, even when the judge misses it", () => {
    const clean = scoreFixture({ manifest: manifest(), reviewerRuns: allRequiredRuns(), actualVerdict: "APPROVE", actualSummary: "ok" });
    const confirmedBlocker = scoreFixture({
      manifest: manifest({ verdict: "DO_NOT_APPROVE" }),
      reviewerRuns: allRequiredRuns({ security: run({ id: "run-security", reviewer: "security", findings: [finding({ severity: "P0" })] }) }),
      actualVerdict: "DO_NOT_APPROVE",
      actualSummary: "Critical issue found.",
    });
    const failedReviewerProbe = scoreFixture({
      manifest: manifest({ verdict: "DO_NOT_APPROVE" }),
      reviewerRuns: allRequiredRuns({ test: run({ id: "run-test", reviewer: "test", status: "failed", findings: [] }) }),
      actualVerdict: "APPROVE",
      actualSummary: "Looks fine.",
    });

    const suite = aggregateScores([clean, confirmedBlocker, failedReviewerProbe]);

    expect(suite.fixturesRun).toBe(3);
    expect(suite.productionFacingFixturesRun).toBe(2);
    // Production-facing recall/accuracy are computed over the 2 real fixtures only — both correct — so they stay perfect
    // even though the raw judge missed the adversarial probe entirely.
    expect(suite.verdictAccuracy).toBe(1);
    expect(suite.blockingDefectRecall).toBe(1);
    expect(suite.missedBlockerRate).toBe(0);
    // The probe's miss is captured ONLY in the separate, explicitly-not-production-facing rate.
    expect(suite.rawJudgeFailedReviewerHandlingRate).toBe(0);
  });
});
