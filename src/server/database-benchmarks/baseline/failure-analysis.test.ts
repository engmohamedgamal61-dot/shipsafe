import path from "node:path";
import { describe, expect, it } from "vitest";
import { BENCHMARK_ROOT, loadFixture } from "../load-fixtures";
import { producedFindingSchema, reviewerResultSchema, scoreFixture, type ProducedFinding } from "../scorer";
import { analyzeFixtureFailure } from "./failure-analysis";

const missingFk = loadFixture(path.join(BENCHMARK_ROOT, "foreign-keys", "01-missing-foreign-key-reference"));
const safeMigration = loadFixture(path.join(BENCHMARK_ROOT, "safe-migration", "01-scoped-uniqueness-and-correct-cascades"));
const ambiguous = loadFixture(path.join(BENCHMARK_ROOT, "ambiguous", "01-index-build-lock-risk-unknown-table-size"));

function finding(overrides: Partial<ProducedFinding>): ProducedFinding {
  return producedFindingSchema.parse({
    category: "foreign-keys.missing-reference",
    severity: "P1",
    confidence: "high",
    file: "migration.sql",
    lineStart: 5,
    lineEnd: 5,
    evidence: "",
    ...overrides,
  });
}

describe("analyzeFixtureFailure", () => {
  it("returns no reasons for a passing fixture", () => {
    const score = scoreFixture(missingFk, reviewerResultSchema.parse({ findings: [finding({})] }));
    expect(analyzeFixtureFailure(missingFk, score)).toEqual([]);
  });

  it("flags 'missed defect' when a required finding goes undetected", () => {
    const score = scoreFixture(missingFk, reviewerResultSchema.parse({ findings: [] }));
    expect(analyzeFixtureFailure(missingFk, score)).toContain("missed defect");
  });

  it("flags 'false positive' for a safe fixture given any finding at all", () => {
    const score = scoreFixture(safeMigration, reviewerResultSchema.parse({ findings: [finding({ file: "migration.sql", lineStart: 9, lineEnd: 9 })] }));
    expect(analyzeFixtureFailure(safeMigration, score)).toContain("false positive");
  });

  it("flags 'hallucination' for a finding citing a file outside the fixture", () => {
    const score = scoreFixture(missingFk, reviewerResultSchema.parse({ findings: [finding({ file: "does-not-exist.sql" })] }));
    expect(analyzeFixtureFailure(missingFk, score)).toContain("hallucination");
  });

  it("flags 'fabricated evidence' for a false backtick-quoted claim", () => {
    const score = scoreFixture(missingFk, reviewerResultSchema.parse({ findings: [finding({ evidence: "Calls `validateRepositoryExists()` first." })] }));
    expect(analyzeFixtureFailure(missingFk, score)).toContain("fabricated evidence");
  });

  it("flags 'overconfidence' for a confident finding on an ambiguous fixture", () => {
    const score = scoreFixture(
      ambiguous,
      reviewerResultSchema.parse({ findings: [finding({ category: "migration-safety.generic", severity: "P1", confidence: "high", file: "migration.sql", lineStart: 3, lineEnd: 3 })] }),
    );
    const reasons = analyzeFixtureFailure(ambiguous, score);
    expect(reasons).toContain("overconfidence");
    expect(reasons).toContain("false positive");
  });

  it("does NOT flag 'overconfidence' for a correct low-confidence match on an ambiguous fixture", () => {
    const score = scoreFixture(
      ambiguous,
      reviewerResultSchema.parse({ findings: [finding({ category: "migration-safety.generic", severity: "P2", confidence: "low", file: "migration.sql", lineStart: 3, lineEnd: 3 })] }),
    );
    expect(analyzeFixtureFailure(ambiguous, score)).toEqual([]);
  });

  it("flags 'duplicate root cause' for a repeated match against the same entry", () => {
    const score = scoreFixture(missingFk, reviewerResultSchema.parse({ findings: [finding({}), finding({})] }));
    expect(analyzeFixtureFailure(missingFk, score)).toContain("duplicate root cause");
  });

  it("flags 'location mismatch' for an allowed-category finding that doesn't correspond to any ground-truth location", () => {
    const score = scoreFixture(missingFk, reviewerResultSchema.parse({ findings: [finding({ lineStart: 1, lineEnd: 1 })] }));
    // migration.sql line 1 is the file's leading comment, not req-1's declared region — no overlap.
    expect(analyzeFixtureFailure(missingFk, score)).toContain("location mismatch");
  });
});
