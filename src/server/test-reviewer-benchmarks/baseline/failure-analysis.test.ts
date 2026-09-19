import path from "node:path";
import { describe, expect, it } from "vitest";
import { BENCHMARK_ROOT, loadFixture } from "../load-fixtures";
import { producedFindingSchema, reviewerResultSchema, scoreFixture, type ProducedFinding } from "../scorer";
import { analyzeFixtureFailure } from "./failure-analysis";

const missingTests = loadFixture(path.join(BENCHMARK_ROOT, "missing-tests", "01-critical-behavior-added-without-tests"));
const safeSuite = loadFixture(path.join(BENCHMARK_ROOT, "safe", "01-comprehensive-test-suite"));
const ambiguous = loadFixture(path.join(BENCHMARK_ROOT, "ambiguous", "01-message-text-changed-tests-not-shown"));
const missingErrorPath = loadFixture(path.join(BENCHMARK_ROOT, "missing-error-path", "01-only-happy-path-tested"));

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

describe("analyzeFixtureFailure", () => {
  it("returns no reasons for a passing fixture", () => {
    const score = scoreFixture(missingTests, reviewerResultSchema.parse({ findings: [finding({})] }));
    expect(analyzeFixtureFailure(missingTests, score)).toEqual([]);
  });

  it("flags 'missed defect' when a required finding goes undetected", () => {
    const score = scoreFixture(missingTests, reviewerResultSchema.parse({ findings: [] }));
    expect(analyzeFixtureFailure(missingTests, score)).toContain("missed defect");
  });

  it("flags 'false positive' for a safe fixture given any finding at all", () => {
    const score = scoreFixture(safeSuite, reviewerResultSchema.parse({ findings: [finding({ category: "missing-error-path.generic", file: "score.test.ts", lineStart: 5, lineEnd: 5 })] }));
    expect(analyzeFixtureFailure(safeSuite, score)).toContain("false positive");
  });

  it("flags 'hallucination' for a finding citing a file outside the fixture", () => {
    const score = scoreFixture(missingTests, reviewerResultSchema.parse({ findings: [finding({ file: "does-not-exist.ts" })] }));
    expect(analyzeFixtureFailure(missingTests, score)).toContain("hallucination");
  });

  it("flags 'fabricated evidence' for a false backtick-quoted claim", () => {
    const score = scoreFixture(missingTests, reviewerResultSchema.parse({ findings: [finding({ evidence: "Calls `validateMergeSafety()` here." })] }));
    expect(analyzeFixtureFailure(missingTests, score)).toContain("fabricated evidence");
  });

  it("flags 'overconfidence' for a confident finding on an ambiguous fixture", () => {
    const score = scoreFixture(
      ambiguous,
      reviewerResultSchema.parse({ findings: [finding({ category: "missing-tests.generic", severity: "P1", confidence: "high", file: "sign-up-validation.ts", lineStart: 1, lineEnd: 6 })] }),
    );
    const reasons = analyzeFixtureFailure(ambiguous, score);
    expect(reasons).toContain("overconfidence");
    expect(reasons).toContain("false positive");
  });

  it("does NOT flag 'overconfidence' for a correct low-confidence match on an ambiguous fixture", () => {
    const score = scoreFixture(
      ambiguous,
      reviewerResultSchema.parse({ findings: [finding({ category: "missing-tests.generic", severity: "P2", confidence: "low", file: "sign-up-validation.ts", lineStart: 1, lineEnd: 6 })] }),
    );
    expect(analyzeFixtureFailure(ambiguous, score)).toEqual([]);
  });

  it("flags 'duplicate root cause' for a repeated match against the same entry", () => {
    const score = scoreFixture(missingTests, reviewerResultSchema.parse({ findings: [finding({}), finding({})] }));
    expect(analyzeFixtureFailure(missingTests, score)).toContain("duplicate root cause");
  });

  it("flags 'location mismatch' for an allowed-category finding that doesn't correspond to any ground-truth location", () => {
    const score = scoreFixture(
      missingErrorPath,
      reviewerResultSchema.parse({ findings: [finding({ category: "missing-error-path.untested-failure-mode", file: "score.test.ts", lineStart: 1, lineEnd: 2 })] }),
    );
    // score.test.ts lines 1-2 are the import statements, not req-1's declared [4,8] region — no overlap.
    expect(analyzeFixtureFailure(missingErrorPath, score)).toContain("location mismatch");
  });
});
