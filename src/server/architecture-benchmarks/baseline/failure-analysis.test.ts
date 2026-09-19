import path from "node:path";
import { describe, expect, it } from "vitest";
import { BENCHMARK_ROOT, loadFixture } from "../load-fixtures";
import { producedFindingSchema, reviewerResultSchema, scoreFixture, type ProducedFinding } from "../scorer";
import { analyzeFixtureFailure } from "./failure-analysis";

const layerBoundaries = loadFixture(path.join(BENCHMARK_ROOT, "layer-boundaries", "01-repository-imports-ui-component"));
const safeDecorator = loadFixture(path.join(BENCHMARK_ROOT, "safe", "01-caching-decorator-follows-ports-pattern"));
const ambiguous = loadFixture(path.join(BENCHMARK_ROOT, "ambiguous", "01-shared-utility-module-unclear-ownership"));

function finding(overrides: Partial<ProducedFinding>): ProducedFinding {
  return producedFindingSchema.parse({
    category: "layer-boundaries.cross-layer-import",
    severity: "P1",
    confidence: "high",
    file: "supabase-adapter.ts",
    lineStart: 2,
    lineEnd: 8,
    evidence: "",
    ...overrides,
  });
}

describe("analyzeFixtureFailure", () => {
  it("returns no reasons for a passing fixture", () => {
    const score = scoreFixture(layerBoundaries, reviewerResultSchema.parse({ findings: [finding({})] }));
    expect(analyzeFixtureFailure(layerBoundaries, score)).toEqual([]);
  });

  it("flags 'missed defect' when a required finding goes undetected", () => {
    const score = scoreFixture(layerBoundaries, reviewerResultSchema.parse({ findings: [] }));
    expect(analyzeFixtureFailure(layerBoundaries, score)).toContain("missed defect");
  });

  it("flags 'false positive' for a safe fixture given any finding at all", () => {
    const score = scoreFixture(safeDecorator, reviewerResultSchema.parse({ findings: [finding({ file: "caching-review-repository.ts", lineStart: 8, lineEnd: 8 })] }));
    expect(analyzeFixtureFailure(safeDecorator, score)).toContain("false positive");
  });

  it("flags 'hallucination' for a finding citing a file outside the fixture", () => {
    const score = scoreFixture(layerBoundaries, reviewerResultSchema.parse({ findings: [finding({ file: "does-not-exist.ts" })] }));
    expect(analyzeFixtureFailure(layerBoundaries, score)).toContain("hallucination");
  });

  it("flags 'fabricated evidence' for a false backtick-quoted claim", () => {
    const score = scoreFixture(layerBoundaries, reviewerResultSchema.parse({ findings: [finding({ evidence: "Calls `renderPreviewCard()` here." })] }));
    expect(analyzeFixtureFailure(layerBoundaries, score)).toContain("fabricated evidence");
  });

  it("flags 'overconfidence' for a confident finding on an ambiguous fixture", () => {
    const score = scoreFixture(
      ambiguous,
      reviewerResultSchema.parse({ findings: [finding({ category: "responsibility-separation.generic", severity: "P1", confidence: "high", file: "shared-utils.ts", lineStart: 5, lineEnd: 7 })] }),
    );
    const reasons = analyzeFixtureFailure(ambiguous, score);
    expect(reasons).toContain("overconfidence");
    expect(reasons).toContain("false positive");
  });

  it("does NOT flag 'overconfidence' for a correct low-confidence match on an ambiguous fixture", () => {
    const score = scoreFixture(
      ambiguous,
      reviewerResultSchema.parse({ findings: [finding({ category: "responsibility-separation.generic", severity: "P2", confidence: "low", file: "shared-utils.ts", lineStart: 5, lineEnd: 7 })] }),
    );
    expect(analyzeFixtureFailure(ambiguous, score)).toEqual([]);
  });

  it("flags 'duplicate root cause' for a repeated match against the same entry", () => {
    const score = scoreFixture(layerBoundaries, reviewerResultSchema.parse({ findings: [finding({}), finding({})] }));
    expect(analyzeFixtureFailure(layerBoundaries, score)).toContain("duplicate root cause");
  });

  it("flags 'location mismatch' for an allowed-category finding that doesn't correspond to any ground-truth location", () => {
    const score = scoreFixture(layerBoundaries, reviewerResultSchema.parse({ findings: [finding({ lineStart: 12, lineEnd: 12 })] }));
    // supabase-adapter.ts line 12 is inside fetchRows, not req-1's declared [2,8] region — no overlap.
    expect(analyzeFixtureFailure(layerBoundaries, score)).toContain("location mismatch");
  });
});
