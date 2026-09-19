import path from "node:path";
import { describe, expect, it } from "vitest";
import { BENCHMARK_ROOT, loadFixture } from "../load-fixtures";
import { producedFindingSchema, reviewerResultSchema, scoreFixture, type ProducedFinding } from "../scorer";
import { analyzeFixtureFailure } from "./failure-analysis";

const offByOne = loadFixture(path.join(BENCHMARK_ROOT, "correctness", "01-off-by-one-pagination"));
const safeRange = loadFixture(path.join(BENCHMARK_ROOT, "correctness", "02-safe-half-open-range"));
const ambiguous = loadFixture(path.join(BENCHMARK_ROOT, "ambiguous", "01-unvalidated-discount-lookup"));

function finding(overrides: Partial<ProducedFinding>): ProducedFinding {
  return producedFindingSchema.parse({
    category: "correctness.off-by-one",
    severity: "P1",
    confidence: "high",
    file: "paginate.ts",
    lineStart: 7,
    lineEnd: 7,
    evidence: "",
    ...overrides,
  });
}

describe("analyzeFixtureFailure", () => {
  it("returns no reasons for a passing fixture", () => {
    const score = scoreFixture(offByOne, reviewerResultSchema.parse({ findings: [finding({})] }));
    expect(analyzeFixtureFailure(offByOne, score)).toEqual([]);
  });

  it("flags 'missed defect' when a required finding goes undetected", () => {
    const score = scoreFixture(offByOne, reviewerResultSchema.parse({ findings: [] }));
    expect(analyzeFixtureFailure(offByOne, score)).toContain("missed defect");
  });

  it("flags 'false positive' for a safe fixture given any finding at all", () => {
    const score = scoreFixture(safeRange, reviewerResultSchema.parse({ findings: [finding({ file: "ranges.ts", lineStart: 9, lineEnd: 9 })] }));
    expect(analyzeFixtureFailure(safeRange, score)).toContain("false positive");
  });

  it("flags 'hallucination' for a finding citing a file outside the fixture", () => {
    const score = scoreFixture(offByOne, reviewerResultSchema.parse({ findings: [finding({ file: "does-not-exist.ts" })] }));
    expect(analyzeFixtureFailure(offByOne, score)).toContain("hallucination");
  });

  it("flags 'fabricated evidence' for a false backtick-quoted claim", () => {
    const score = scoreFixture(offByOne, reviewerResultSchema.parse({ findings: [finding({ evidence: "Calls `validatePageBounds()` first." })] }));
    expect(analyzeFixtureFailure(offByOne, score)).toContain("fabricated evidence");
  });

  it("flags 'overconfidence' for a confident finding on an ambiguous fixture", () => {
    const score = scoreFixture(
      ambiguous,
      reviewerResultSchema.parse({ findings: [finding({ category: "correctness.generic", severity: "P1", confidence: "high", file: "apply-discount.ts", lineStart: 11, lineEnd: 12 })] }),
    );
    const reasons = analyzeFixtureFailure(ambiguous, score);
    expect(reasons).toContain("overconfidence");
    expect(reasons).toContain("false positive");
  });

  it("does NOT flag 'overconfidence' for a correct low-confidence match on an ambiguous fixture", () => {
    const score = scoreFixture(
      ambiguous,
      reviewerResultSchema.parse({ findings: [finding({ category: "correctness.generic", severity: "P2", confidence: "low", file: "apply-discount.ts", lineStart: 11, lineEnd: 12 })] }),
    );
    expect(analyzeFixtureFailure(ambiguous, score)).toEqual([]);
  });

  it("flags 'duplicate root cause' for a repeated match against the same entry", () => {
    const score = scoreFixture(offByOne, reviewerResultSchema.parse({ findings: [finding({}), finding({})] }));
    expect(analyzeFixtureFailure(offByOne, score)).toContain("duplicate root cause");
  });

  it("flags 'location mismatch' for an allowed-category finding that doesn't correspond to any ground-truth location", () => {
    const score = scoreFixture(offByOne, reviewerResultSchema.parse({ findings: [finding({ lineStart: 1, lineEnd: 1 })] }));
    // paginate.ts line 1 is the file's doc comment, not req-1's declared region — no overlap.
    expect(analyzeFixtureFailure(offByOne, score)).toContain("location mismatch");
  });
});
