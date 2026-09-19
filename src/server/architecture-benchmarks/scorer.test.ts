import path from "node:path";
import { describe, expect, it } from "vitest";
import { BENCHMARK_ROOT, loadFixture, type LoadedFixture } from "./load-fixtures";
import { expectedFixtureSchema } from "./schema";
import { aggregateScores, producedFindingSchema, reviewerResultSchema, scoreFixture, type ProducedFinding, type ReviewerResult } from "./scorer";

const layerBoundaries = loadFixture(path.join(BENCHMARK_ROOT, "layer-boundaries", "01-repository-imports-ui-component"));
const safeDecorator = loadFixture(path.join(BENCHMARK_ROOT, "safe", "01-caching-decorator-follows-ports-pattern"));
const safeTypeOnly = loadFixture(path.join(BENCHMARK_ROOT, "safe", "02-type-only-cross-layer-import-is-fine"));
const ambiguous = loadFixture(path.join(BENCHMARK_ROOT, "ambiguous", "01-shared-utility-module-unclear-ownership"));
const circularDependency = loadFixture(path.join(BENCHMARK_ROOT, "circular-dependency", "01-mutual-imports-between-services"));
const duplication = loadFixture(path.join(BENCHMARK_ROOT, "duplication", "01-severity-order-duplicated-across-modules"));

const overlappingTestFixture: LoadedFixture = {
  fixtureDir: "/synthetic/overlap-test",
  manifest: expectedFixtureSchema.parse({
    fixture_id: "synthetic-overlap-test",
    domain: "test",
    tags: ["buggy"],
    description: "Synthetic fixture exercising alternate_categories disambiguation.",
    files: ["main.ts"],
    expected: {
      needs_more_context_acceptable: false,
      allowed_categories: ["layer-boundaries.cross-layer-import", "coupling.generic"],
      prohibited_categories: [],
      required_findings: [
        {
          id: "req-1",
          rule_id: "ARCH-TEST-001",
          category: "layer-boundaries.cross-layer-import",
          alternate_categories: ["coupling.generic"],
          files: ["main.ts"],
          line_ranges: { "main.ts": [1, 5] },
          severity_range: ["P1", "P1"],
          confidence_range: ["medium", "high"],
          justification: "Synthetic.",
        },
      ],
      optional_findings: [
        {
          id: "opt-1",
          rule_id: "ARCH-TEST-002",
          category: "duplication.generic",
          files: ["main.ts"],
          line_ranges: { "main.ts": [1, 5] },
          severity_range: ["Nit", "P2"],
          confidence_range: ["low", "low"],
          justification: "Synthetic sibling requiring disambiguation.",
        },
      ],
    },
  }),
  sourceFiles: { "main.ts": "export const x = 1;\n" },
};

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

function result(findings: ProducedFinding[], overrides: Partial<ReviewerResult> = {}): ReviewerResult {
  return reviewerResultSchema.parse({ needsMoreContext: false, findings, ...overrides });
}

describe("scoreFixture — core scenarios", () => {
  it("perfect answer: matches the required finding exactly", () => {
    const score = scoreFixture(layerBoundaries, result([finding({ evidence: "RepositoryCard({ repository: row })" })]));
    expect(score.passed).toBe(true);
    expect(score.requiredFindingsDetected).toEqual(["req-1"]);
    expect(score.rawScore).toBe(1);
    expect(score.normalizedScore).toBe(1);
  });

  it("missed defect: zero findings against a buggy fixture", () => {
    const score = scoreFixture(layerBoundaries, result([]));
    expect(score.passed).toBe(false);
    expect(score.requiredFindingsMissed).toEqual(["req-1"]);
    expect(score.rawScore).toBe(-1);
  });

  it("false positive on a safe fixture: any finding at all is prohibited", () => {
    const score = scoreFixture(safeDecorator, result([finding({ category: "coupling.generic", file: "caching-review-repository.ts", lineStart: 8, lineEnd: 8, evidence: "" })]));
    expect(score.passed).toBe(false);
    expect(score.prohibitedFindings).toHaveLength(1);
  });

  it("clean pass on a safe fixture: zero findings", () => {
    const score = scoreFixture(safeDecorator, result([]));
    expect(score.passed).toBe(true);
    expect(score.normalizedScore).toBe(1);
  });

  it("false-positive-trap fixture: flagging a type-only, correct-direction import is prohibited", () => {
    const score = scoreFixture(
      safeTypeOnly,
      result([finding({ category: "layer-boundaries.cross-layer-import", file: "review-list.tsx", lineStart: 1, lineEnd: 1, evidence: "" })]),
    );
    expect(score.passed).toBe(false);
    expect(score.prohibitedFindings).toHaveLength(1);
  });

  it("ambiguous fixture: a single low-confidence finding matching opt-1 is accepted", () => {
    const score = scoreFixture(
      ambiguous,
      result([finding({ category: "responsibility-separation.generic", confidence: "low", severity: "P2", file: "shared-utils.ts", lineStart: 5, lineEnd: 7, evidence: "" })]),
    );
    expect(score.optionalFindingsAccepted).toEqual(["opt-1"]);
    expect(score.passed).toBe(true);
  });

  it("ambiguous fixture: a confident (non-low) finding is an overclaim, classified as prohibited", () => {
    const score = scoreFixture(
      ambiguous,
      result([finding({ category: "responsibility-separation.generic", confidence: "medium", severity: "P1", file: "shared-utils.ts", lineStart: 5, lineEnd: 7, evidence: "" })]),
    );
    expect(score.prohibitedFindings).toHaveLength(1);
    expect(score.passed).toBe(false);
  });

  it("ambiguous fixture: zero findings is also a fully correct answer", () => {
    const score = scoreFixture(ambiguous, result([]));
    expect(score.passed).toBe(true);
    expect(score.normalizedScore).toBe(1);
  });

  it("multi-file circular-dependency fixture: a finding anchored to either file matches the same entry", () => {
    const scoreA = scoreFixture(
      circularDependency,
      result([finding({ category: "circular-dependency.mutual-module-imports", file: "ingest.ts", lineStart: 1, lineEnd: 1, evidence: "" })]),
    );
    expect(scoreA.requiredFindingsDetected).toEqual(["req-1"]);

    const scoreB = scoreFixture(
      circularDependency,
      result([finding({ category: "circular-dependency.mutual-module-imports", file: "seed.ts", lineStart: 1, lineEnd: 1, evidence: "" })]),
    );
    expect(scoreB.requiredFindingsDetected).toEqual(["req-1"]);
  });

  it("multi-file circular-dependency fixture: findings for BOTH files collapse to one match plus one duplicate", () => {
    const score = scoreFixture(
      circularDependency,
      result([
        finding({ category: "circular-dependency.mutual-module-imports", file: "ingest.ts", lineStart: 1, lineEnd: 1, evidence: "" }),
        finding({ category: "circular-dependency.mutual-module-imports", file: "seed.ts", lineStart: 1, lineEnd: 1, evidence: "" }),
      ]),
    );
    expect(score.requiredFindingsDetected).toEqual(["req-1"]);
    expect(score.duplicates).toHaveLength(1);
  });

  it("multi-file duplication fixture: a finding citing either file matches the same entry", () => {
    const score = scoreFixture(
      duplication,
      result([finding({ category: "duplication.domain-logic-duplicated", file: "dashboard-summary.ts", lineStart: 3, lineEnd: 3, evidence: "" })]),
    );
    expect(score.requiredFindingsDetected).toEqual(["req-1"]);
  });

  it("hallucinated path: a finding citing a file not in the fixture", () => {
    const score = scoreFixture(layerBoundaries, result([finding({ file: "does-not-exist.ts", lineStart: 1, lineEnd: 1, evidence: "" })]));
    expect(score.hallucinatedPaths).toHaveLength(1);
    expect(score.hardFailure).toBe(true);
    expect(score.normalizedScore).toBe(0);
  });

  it("fabricated evidence: a quoted span that never appears in the source", () => {
    const score = scoreFixture(layerBoundaries, result([finding({ evidence: "This calls `renderRepositoryPreview()` from the UI layer." })]));
    expect(score.fabricatedEvidence).toHaveLength(1);
    expect(score.hardFailure).toBe(true);
  });

  it("a verifiable bare dotted identifier reference is NOT fabricated evidence (the fixed exemption)", () => {
    const score = scoreFixture(layerBoundaries, result([finding({ evidence: "Every module like `SupabaseReviewRepository.listRepositoriesForUser` should stay UI-free." })]));
    expect(score.fabricatedEvidence).toHaveLength(0);
  });

  it("an illustrative 'e.g.' example is NOT fabricated evidence", () => {
    const score = scoreFixture(layerBoundaries, result([finding({ evidence: "A UI import, e.g. `import { SomeOtherComponent }`, should never appear here." })]));
    expect(score.fabricatedEvidence).toHaveLength(0);
  });

  it("duplicate root cause: two findings matching the same required entry", () => {
    const score = scoreFixture(layerBoundaries, result([finding({ evidence: "" }), finding({ evidence: "" })]));
    expect(score.duplicates).toHaveLength(1);
    expect(score.requiredFindingsDetected).toEqual(["req-1"]);
  });

  it("category disambiguation: alternate_categories on an overlapping pair correctly distinguishes req-1 from opt-1", () => {
    const score = scoreFixture(overlappingTestFixture, result([finding({ category: "coupling.generic", file: "main.ts", lineStart: 2, lineEnd: 2, evidence: "" })]));
    expect(score.requiredFindingsDetected).toEqual(["req-1"]);
  });

  it("severity inflation and understatement are both tracked", () => {
    const inflated = scoreFixture(layerBoundaries, result([finding({ severity: "P0", evidence: "" })]));
    expect(inflated.severityAccuracy.inflated).toBe(1);

    const understated = scoreFixture(layerBoundaries, result([finding({ severity: "Nit", evidence: "" })]));
    expect(understated.severityAccuracy.understated).toBe(1);
  });

  it("category accuracy: an exact-category match on a matched_required finding is accurate", () => {
    const score = scoreFixture(layerBoundaries, result([finding({ category: "layer-boundaries.cross-layer-import", evidence: "" })]));
    expect(score.categoryAccuracyObservations).toEqual([true]);
  });

  it("category accuracy: a generic-bucket match via the compatibility layer is inaccurate relative to the fixture's specific category", () => {
    const score = scoreFixture(layerBoundaries, result([finding({ category: "layering", evidence: "" })]));
    expect(score.categoryAccuracyObservations).toEqual([false]);
  });
});

describe("aggregateScores", () => {
  it("computes precision/recall/duplicate rate across a small suite", () => {
    const scores = [
      scoreFixture(layerBoundaries, result([finding({ evidence: "" })])),
      scoreFixture(safeDecorator, result([])),
      scoreFixture(circularDependency, result([])),
    ];
    const suite = aggregateScores(scores);
    expect(suite.fixturesRun).toBe(3);
    expect(suite.recall).toBeCloseTo(0.5, 5); // 1 of 2 required findings detected
    expect(suite.duplicateRate).toBe(0);
  });

  it("categoryAccuracyRate is vacuously 1 when no matched_required findings exist", () => {
    const suite = aggregateScores([scoreFixture(safeDecorator, result([]))]);
    expect(suite.categoryAccuracyRate).toBe(1);
  });
});
