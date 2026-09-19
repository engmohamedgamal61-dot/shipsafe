import path from "node:path";
import { describe, expect, it } from "vitest";
import { BENCHMARK_ROOT, loadFixture, type LoadedFixture } from "./load-fixtures";
import { expectedFixtureSchema } from "./schema";
import { aggregateScores, producedFindingSchema, reviewerResultSchema, scoreFixture, type ProducedFinding, type ReviewerResult } from "./scorer";

const missingTests = loadFixture(path.join(BENCHMARK_ROOT, "missing-tests", "01-critical-behavior-added-without-tests"));
const safeSuite = loadFixture(path.join(BENCHMARK_ROOT, "safe", "01-comprehensive-test-suite"));
const safeClockMock = loadFixture(path.join(BENCHMARK_ROOT, "safe", "02-legitimate-clock-mock"));
const ambiguous = loadFixture(path.join(BENCHMARK_ROOT, "ambiguous", "01-message-text-changed-tests-not-shown"));
const missingErrorPath = loadFixture(path.join(BENCHMARK_ROOT, "missing-error-path", "01-only-happy-path-tested"));
const duplicatedTests = loadFixture(path.join(BENCHMARK_ROOT, "duplicated-tests", "01-three-tests-assert-the-same-thing"));
const mockFidelity = loadFixture(path.join(BENCHMARK_ROOT, "mock-fidelity", "01-mock-hides-real-integration-contract"));
const weakAssertions = loadFixture(path.join(BENCHMARK_ROOT, "weak-assertions", "01-tautological-assertion-proves-nothing"));

const overlappingTestFixture: LoadedFixture = {
  fixtureDir: "/synthetic/overlap-test",
  manifest: expectedFixtureSchema.parse({
    fixture_id: "synthetic-overlap-test",
    domain: "test",
    tags: ["buggy"],
    description: "Synthetic fixture exercising alternate_categories disambiguation.",
    files: ["main.test.ts"],
    expected: {
      needs_more_context_acceptable: false,
      allowed_categories: ["weak-assertions.tautological", "brittle-tests.generic"],
      prohibited_categories: [],
      required_findings: [
        {
          id: "req-1",
          rule_id: "TEST-TEST-001",
          category: "weak-assertions.tautological",
          alternate_categories: ["brittle-tests.generic"],
          files: ["main.test.ts"],
          line_ranges: { "main.test.ts": [1, 5] },
          severity_range: ["P1", "P1"],
          confidence_range: ["medium", "high"],
          justification: "Synthetic.",
        },
      ],
      optional_findings: [
        {
          id: "opt-1",
          rule_id: "TEST-TEST-002",
          category: "duplicated-tests.generic",
          files: ["main.test.ts"],
          line_ranges: { "main.test.ts": [1, 5] },
          severity_range: ["Nit", "P2"],
          confidence_range: ["low", "low"],
          justification: "Synthetic sibling requiring disambiguation.",
        },
      ],
    },
  }),
  sourceFiles: { "main.test.ts": "it('x', () => { expect(true).toBe(true); });\n" },
};

function finding(overrides: Partial<ProducedFinding>): ProducedFinding {
  return producedFindingSchema.parse({
    category: "missing-tests.critical-behavior",
    severity: "P1",
    confidence: "high",
    file: "verdict.ts",
    lineStart: 1,
    lineEnd: 5,
    evidence: "",
    ...overrides,
  });
}

function result(findings: ProducedFinding[], overrides: Partial<ReviewerResult> = {}): ReviewerResult {
  return reviewerResultSchema.parse({ needsMoreContext: false, findings, ...overrides });
}

describe("scoreFixture — core scenarios", () => {
  it("perfect answer: matches the required finding exactly", () => {
    const score = scoreFixture(missingTests, result([finding({ evidence: "computeAutoMergeEligibility" })]));
    expect(score.passed).toBe(true);
    expect(score.requiredFindingsDetected).toEqual(["req-1"]);
    expect(score.rawScore).toBe(1);
    expect(score.normalizedScore).toBe(1);
  });

  it("missed defect: zero findings against a buggy fixture", () => {
    const score = scoreFixture(missingTests, result([]));
    expect(score.passed).toBe(false);
    expect(score.requiredFindingsMissed).toEqual(["req-1"]);
    expect(score.rawScore).toBe(-1);
  });

  it("false positive on a safe fixture: any finding at all is prohibited", () => {
    const score = scoreFixture(safeSuite, result([finding({ category: "missing-error-path.generic", file: "score.test.ts", lineStart: 5, lineEnd: 5, evidence: "" })]));
    expect(score.passed).toBe(false);
    expect(score.prohibitedFindings).toHaveLength(1);
  });

  it("clean pass on a safe fixture: zero findings", () => {
    const score = scoreFixture(safeSuite, result([]));
    expect(score.passed).toBe(true);
    expect(score.normalizedScore).toBe(1);
  });

  it("false-positive-trap fixture: flagging a legitimate clock mock as hiding the real contract is prohibited", () => {
    const score = scoreFixture(
      safeClockMock,
      result([finding({ category: "mock-fidelity.hides-real-contract", file: "staleness.test.ts", lineStart: 1, lineEnd: 1, evidence: "" })]),
    );
    expect(score.passed).toBe(false);
    expect(score.prohibitedFindings).toHaveLength(1);
  });

  it("ambiguous fixture: a single low-confidence finding matching opt-1 is accepted", () => {
    const score = scoreFixture(
      ambiguous,
      result([finding({ category: "missing-tests.generic", confidence: "low", severity: "P2", file: "sign-up-validation.ts", lineStart: 1, lineEnd: 6, evidence: "" })]),
    );
    expect(score.optionalFindingsAccepted).toEqual(["opt-1"]);
    expect(score.passed).toBe(true);
  });

  it("ambiguous fixture: a confident (non-low) finding is an overclaim, classified as prohibited", () => {
    const score = scoreFixture(
      ambiguous,
      result([finding({ category: "missing-tests.generic", confidence: "medium", severity: "P1", file: "sign-up-validation.ts", lineStart: 1, lineEnd: 6, evidence: "" })]),
    );
    expect(score.prohibitedFindings).toHaveLength(1);
    expect(score.passed).toBe(false);
  });

  it("ambiguous fixture: zero findings is also a fully correct answer", () => {
    const score = scoreFixture(ambiguous, result([]));
    expect(score.passed).toBe(true);
    expect(score.normalizedScore).toBe(1);
  });

  it("multi-file missing-error-path fixture: a finding correctly anchored to the test file (not the production file) matches", () => {
    const score = scoreFixture(
      missingErrorPath,
      result([finding({ category: "missing-error-path.untested-failure-mode", file: "score.test.ts", lineStart: 4, lineEnd: 8, evidence: "" })]),
    );
    expect(score.requiredFindingsDetected).toEqual(["req-1"]);
  });

  it("multi-file missing-error-path fixture: a correctness finding on the production file itself is prohibited (lane discipline)", () => {
    const score = scoreFixture(
      missingErrorPath,
      result([finding({ category: "correctness.generic", file: "score.ts", lineStart: 2, lineEnd: 2, evidence: "" })]),
    );
    expect(score.prohibitedFindings).toHaveLength(1);
  });

  it("duplicated-tests fixture: three separate findings for the same redundant-test group collapse to one match plus two duplicates", () => {
    const score = scoreFixture(
      duplicatedTests,
      result([
        finding({ category: "duplicated-tests.redundant-coverage", file: "score.test.ts", lineStart: 5, lineEnd: 7, evidence: "" }),
        finding({ category: "duplicated-tests.redundant-coverage", file: "score.test.ts", lineStart: 9, lineEnd: 11, evidence: "" }),
        finding({ category: "duplicated-tests.redundant-coverage", file: "score.test.ts", lineStart: 13, lineEnd: 15, evidence: "" }),
      ]),
    );
    expect(score.requiredFindingsDetected).toEqual(["req-1"]);
    expect(score.duplicates).toHaveLength(2);
  });

  it("a bare source-file-name mention is NOT fabricated evidence, even for a file not shown in the fixture (the fixed exemption)", () => {
    const score = scoreFixture(missingTests, result([finding({ evidence: "The sibling implementation in `verdict-helpers.ts` is not part of this diff." })]));
    expect(score.fabricatedEvidence).toHaveLength(0);
  });

  it("a bare common JS/TS reserved word or literal is NOT fabricated evidence (the fixed exemption)", () => {
    const score = scoreFixture(missingTests, result([finding({ evidence: "This function always returns `true` or `false`, never `undefined`." })]));
    expect(score.fabricatedEvidence).toHaveLength(0);
  });

  it("a bare 'await'/'return' keyword reference is NOT fabricated evidence even when the point is that they are MISSING", () => {
    const score = scoreFixture(missingTests, result([finding({ evidence: "The assertion is missing `await` and there is no `return` statement." })]));
    expect(score.fabricatedEvidence).toHaveLength(0);
  });

  it("a multi-word span merely containing a reserved word is still fully checked, not exempted", () => {
    const score = scoreFixture(missingTests, result([finding({ evidence: "The code literally says `return true always no matter what`." })]));
    expect(score.fabricatedEvidence).toHaveLength(1);
  });

  it("a method-chain reference where each segment carries its own call parens is verified, not fabricated (the fixed exemption)", () => {
    const score = scoreFixture(
      mockFidelity,
      result([
        finding({
          category: "mock-fidelity.hides-real-contract",
          file: "attach-review-status.test.ts",
          lineStart: 4,
          lineEnd: 12,
          evidence: "The mock only implements `select().in()`, hand-crafted to match the code's own expectations rather than the real client's contract.",
        }),
      ]),
    );
    expect(score.fabricatedEvidence).toHaveLength(0);
  });

  it("quote-style is normalized: a single-quoted description of a double-quoted source string is not fabricated", () => {
    const score = scoreFixture(
      weakAssertions,
      result([finding({ category: "weak-assertions.tautological", file: "verdict.test.ts", lineStart: 5, lineEnd: 8, evidence: "The call is effectively `computeAutoMergeEligibility('APPROVE', [])`." })]),
    );
    expect(score.fabricatedEvidence).toHaveLength(0);
  });

  it("hallucinated path: a finding citing a file not in the fixture", () => {
    const score = scoreFixture(missingTests, result([finding({ file: "does-not-exist.ts", lineStart: 1, lineEnd: 1, evidence: "" })]));
    expect(score.hallucinatedPaths).toHaveLength(1);
    expect(score.hardFailure).toBe(true);
    expect(score.normalizedScore).toBe(0);
  });

  it("fabricated evidence: a quoted span that never appears in the source", () => {
    const score = scoreFixture(missingTests, result([finding({ evidence: "This calls `validateMergeSafety()` internally." })]));
    expect(score.fabricatedEvidence).toHaveLength(1);
    expect(score.hardFailure).toBe(true);
  });

  it("a verifiable bare dotted identifier reference is NOT fabricated evidence (the fixed exemption)", () => {
    const score = scoreFixture(missingTests, result([finding({ evidence: "Every policy function like `computeAutoMergeEligibility.name` should have tests." })]));
    expect(score.fabricatedEvidence).toHaveLength(0);
  });

  it("an illustrative 'e.g.' example is NOT fabricated evidence", () => {
    const score = scoreFixture(missingTests, result([finding({ evidence: "A test could assert a specific case, e.g. `mixedSeverities()`, but none exists." })]));
    expect(score.fabricatedEvidence).toHaveLength(0);
  });

  it("duplicate root cause: two findings matching the same required entry", () => {
    const score = scoreFixture(missingTests, result([finding({ evidence: "" }), finding({ evidence: "" })]));
    expect(score.duplicates).toHaveLength(1);
    expect(score.requiredFindingsDetected).toEqual(["req-1"]);
  });

  it("category disambiguation: alternate_categories on an overlapping pair correctly distinguishes req-1 from opt-1", () => {
    const score = scoreFixture(
      overlappingTestFixture,
      result([finding({ category: "brittle-tests.generic", file: "main.test.ts", lineStart: 2, lineEnd: 2, evidence: "" })]),
    );
    expect(score.requiredFindingsDetected).toEqual(["req-1"]);
  });

  it("severity inflation and understatement are both tracked", () => {
    const inflated = scoreFixture(missingTests, result([finding({ severity: "P0", evidence: "" })]));
    expect(inflated.severityAccuracy.inflated).toBe(1);

    const understated = scoreFixture(missingTests, result([finding({ severity: "Nit", evidence: "" })]));
    expect(understated.severityAccuracy.understated).toBe(1);
  });

  it("category accuracy: an exact-category match on a matched_required finding is accurate", () => {
    const score = scoreFixture(missingTests, result([finding({ category: "missing-tests.critical-behavior", evidence: "" })]));
    expect(score.categoryAccuracyObservations).toEqual([true]);
  });

  it("category accuracy: a generic-bucket match via the compatibility layer is inaccurate relative to the fixture's specific category", () => {
    const score = scoreFixture(missingTests, result([finding({ category: "missing-tests", evidence: "" })]));
    expect(score.categoryAccuracyObservations).toEqual([false]);
  });
});

describe("aggregateScores", () => {
  it("computes precision/recall/duplicate rate across a small suite", () => {
    const scores = [
      scoreFixture(missingTests, result([finding({ evidence: "" })])),
      scoreFixture(safeSuite, result([])),
      scoreFixture(duplicatedTests, result([])),
    ];
    const suite = aggregateScores(scores);
    expect(suite.fixturesRun).toBe(3);
    expect(suite.recall).toBeCloseTo(0.5, 5); // 1 of 2 required findings detected
    expect(suite.duplicateRate).toBe(0);
  });

  it("categoryAccuracyRate is vacuously 1 when no matched_required findings exist", () => {
    const suite = aggregateScores([scoreFixture(safeSuite, result([]))]);
    expect(suite.categoryAccuracyRate).toBe(1);
  });
});
