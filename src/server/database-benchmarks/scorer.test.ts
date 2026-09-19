import path from "node:path";
import { describe, expect, it } from "vitest";
import { BENCHMARK_ROOT, loadFixture, type LoadedFixture } from "./load-fixtures";
import { expectedFixtureSchema } from "./schema";
import { aggregateScores, producedFindingSchema, reviewerResultSchema, scoreFixture, type ProducedFinding, type ReviewerResult } from "./scorer";

const missingFk = loadFixture(path.join(BENCHMARK_ROOT, "foreign-keys", "01-missing-foreign-key-reference"));
const safeMigration = loadFixture(path.join(BENCHMARK_ROOT, "safe-migration", "01-scoped-uniqueness-and-correct-cascades"));
const reviewerLane = loadFixture(path.join(BENCHMARK_ROOT, "reviewer-lane", "01-schema-correct-tenant-table-no-rls"));
const ambiguous = loadFixture(path.join(BENCHMARK_ROOT, "ambiguous", "01-index-build-lock-risk-unknown-table-size"));
const raceCondition = loadFixture(path.join(BENCHMARK_ROOT, "race-condition", "01-missing-unique-constraint-duplicate-invite"));
const cascadeDelete = loadFixture(path.join(BENCHMARK_ROOT, "cascade-delete", "01-unsafe-cascade-destroys-audit-trail"));

const overlappingTestFixture: LoadedFixture = {
  fixtureDir: "/synthetic/overlap-test",
  manifest: expectedFixtureSchema.parse({
    fixture_id: "synthetic-overlap-test",
    domain: "test",
    tags: ["buggy"],
    description: "Synthetic fixture exercising alternate_categories disambiguation.",
    files: ["main.sql"],
    expected: {
      needs_more_context_acceptable: false,
      allowed_categories: ["foreign-keys.missing-reference", "data-integrity.generic"],
      prohibited_categories: [],
      required_findings: [
        {
          id: "req-1",
          rule_id: "DB-TEST-001",
          category: "foreign-keys.missing-reference",
          alternate_categories: ["data-integrity.generic"],
          files: ["main.sql"],
          line_ranges: { "main.sql": [1, 5] },
          severity_range: ["P1", "P1"],
          confidence_range: ["medium", "high"],
          justification: "Synthetic.",
        },
      ],
      optional_findings: [
        {
          id: "opt-1",
          rule_id: "DB-TEST-002",
          category: "migration-safety.generic",
          files: ["main.sql"],
          line_ranges: { "main.sql": [1, 5] },
          severity_range: ["Nit", "P2"],
          confidence_range: ["low", "low"],
          justification: "Synthetic sibling requiring disambiguation.",
        },
      ],
    },
  }),
  sourceFiles: { "main.sql": "create table public.main (id uuid);\n" },
};

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

function result(findings: ProducedFinding[], overrides: Partial<ReviewerResult> = {}): ReviewerResult {
  return reviewerResultSchema.parse({ needsMoreContext: false, findings, ...overrides });
}

describe("scoreFixture — core scenarios", () => {
  it("perfect answer: matches the required finding exactly", () => {
    const score = scoreFixture(missingFk, result([finding({ evidence: "repository_id uuid not null," })]));
    expect(score.passed).toBe(true);
    expect(score.requiredFindingsDetected).toEqual(["req-1"]);
    expect(score.rawScore).toBe(1);
    expect(score.normalizedScore).toBe(1);
  });

  it("missed defect: zero findings against a buggy fixture", () => {
    const score = scoreFixture(missingFk, result([]));
    expect(score.passed).toBe(false);
    expect(score.requiredFindingsMissed).toEqual(["req-1"]);
    expect(score.rawScore).toBe(-1);
  });

  it("false positive on a safe fixture: any finding at all is prohibited", () => {
    const score = scoreFixture(
      safeMigration,
      result([finding({ category: "cascade-delete.generic", file: "migration.sql", lineStart: 5, lineEnd: 5, evidence: "" })]),
    );
    expect(score.passed).toBe(false);
    expect(score.prohibitedFindings).toHaveLength(1);
  });

  it("clean pass on a safe fixture: zero findings", () => {
    const score = scoreFixture(safeMigration, result([]));
    expect(score.passed).toBe(true);
    expect(score.normalizedScore).toBe(1);
  });

  it("reviewer-lane fixture: a tenant-isolation finding on a schema-correct table is prohibited (lane drift)", () => {
    const score = scoreFixture(
      reviewerLane,
      result([finding({ category: "tenant-isolation.generic", file: "migration.sql", lineStart: 3, lineEnd: 10, evidence: "" })]),
    );
    expect(score.passed).toBe(false);
    expect(score.prohibitedFindings).toHaveLength(1);
  });

  it("ambiguous fixture: a single low-confidence finding matching opt-1 is accepted", () => {
    const score = scoreFixture(
      ambiguous,
      result([finding({ category: "migration-safety.generic", confidence: "low", severity: "P2", file: "migration.sql", lineStart: 3, lineEnd: 3, evidence: "" })]),
    );
    expect(score.optionalFindingsAccepted).toEqual(["opt-1"]);
    expect(score.passed).toBe(true);
  });

  it("ambiguous fixture: a confident (non-low) finding is an overclaim, classified as prohibited", () => {
    const score = scoreFixture(
      ambiguous,
      result([finding({ category: "migration-safety.generic", confidence: "medium", severity: "P1", file: "migration.sql", lineStart: 3, lineEnd: 3, evidence: "" })]),
    );
    expect(score.prohibitedFindings).toHaveLength(1);
    expect(score.passed).toBe(false);
  });

  it("ambiguous fixture: zero findings is also a fully correct answer", () => {
    const score = scoreFixture(ambiguous, result([]));
    expect(score.passed).toBe(true);
    expect(score.normalizedScore).toBe(1);
  });

  it("hallucinated path: a finding citing a file not in the fixture", () => {
    const score = scoreFixture(missingFk, result([finding({ file: "does-not-exist.sql", lineStart: 1, lineEnd: 1, evidence: "" })]));
    expect(score.hallucinatedPaths).toHaveLength(1);
    expect(score.hardFailure).toBe(true);
    expect(score.normalizedScore).toBe(0);
  });

  it("fabricated evidence: a quoted span that never appears in the source", () => {
    const score = scoreFixture(missingFk, result([finding({ evidence: "The column is declared as `repository_id integer not null unique`." })]));
    expect(score.fabricatedEvidence).toHaveLength(1);
    expect(score.hardFailure).toBe(true);
  });

  it("a verifiable bare dotted identifier reference is NOT fabricated evidence (the fixed exemption) even though it never appears as that exact dotted expression in source", () => {
    const score = scoreFixture(
      missingFk,
      result([finding({ evidence: "Every column like `webhook_deliveries.repository_id` should be traceable to a real row." })]),
    );
    expect(score.fabricatedEvidence).toHaveLength(0);
  });

  it("an invented identifier that does NOT appear anywhere in source IS fabricated evidence, even in dotted-reference shape", () => {
    const score = scoreFixture(missingFk, result([finding({ evidence: "This is similar to `some.fabricated.helper()`." })]));
    expect(score.fabricatedEvidence).toHaveLength(1);
  });

  it("an illustrative 'e.g.' example is NOT fabricated evidence", () => {
    const score = scoreFixture(missingFk, result([finding({ evidence: "e.g. `references public.repositories (id) on delete restrict` would fix this." })]));
    expect(score.fabricatedEvidence).toHaveLength(0);
  });

  it("duplicate root cause: two findings matching the same required entry", () => {
    const score = scoreFixture(missingFk, result([finding({ evidence: "" }), finding({ evidence: "" })]));
    expect(score.duplicates).toHaveLength(1);
    expect(score.requiredFindingsDetected).toEqual(["req-1"]);
  });

  it("legacy category mapped via the compatibility layer still matches by location on a fixture with no disambiguation need", () => {
    const score = scoreFixture(missingFk, result([finding({ category: "foreign-key", evidence: "" })]));
    expect(score.requiredFindingsDetected).toEqual(["req-1"]);
  });

  it("category disambiguation: alternate_categories on an overlapping pair correctly distinguishes req-1 from opt-1", () => {
    const score = scoreFixture(
      overlappingTestFixture,
      result([finding({ category: "data-integrity.generic", file: "main.sql", lineStart: 2, lineEnd: 2, evidence: "" })]),
    );
    expect(score.requiredFindingsDetected).toEqual(["req-1"]);
  });

  it("severity inflation and understatement are both tracked", () => {
    const inflated = scoreFixture(missingFk, result([finding({ severity: "P0", evidence: "" })]));
    expect(inflated.severityAccuracy.inflated).toBe(1);

    const understated = scoreFixture(missingFk, result([finding({ severity: "Nit", evidence: "" })]));
    expect(understated.severityAccuracy.understated).toBe(1);
  });

  it("category accuracy: an exact-category match on a matched_required finding is accurate", () => {
    const score = scoreFixture(missingFk, result([finding({ category: "foreign-keys.missing-reference", evidence: "" })]));
    expect(score.categoryAccuracyObservations).toEqual([true]);
  });

  it("category accuracy: a generic-bucket match via the compatibility layer is inaccurate relative to the fixture's specific category", () => {
    const score = scoreFixture(missingFk, result([finding({ category: "data-integrity", evidence: "" })]));
    expect(score.categoryAccuracyObservations).toEqual([false]);
  });

  it("cascade-delete fixture: the required actor_id finding plus an optional workspace_id observation both accepted (Phase 4 fixture correction)", () => {
    const score = scoreFixture(
      cascadeDelete,
      result([
        finding({ category: "cascade-delete.unsafe-cascade", file: "migration.sql", lineStart: 6, lineEnd: 6, severity: "P1", evidence: "" }),
        finding({ category: "cascade-delete.unsafe-cascade", file: "migration.sql", lineStart: 5, lineEnd: 5, severity: "P2", confidence: "low", evidence: "" }),
      ]),
    );
    expect(score.requiredFindingsDetected).toEqual(["req-1"]);
    expect(score.optionalFindingsAccepted).toEqual(["opt-1"]);
    expect(score.passed).toBe(true);
  });

  it("cascade-delete fixture: the required actor_id finding alone (without the optional workspace_id observation) still fully passes", () => {
    const score = scoreFixture(cascadeDelete, result([finding({ category: "cascade-delete.unsafe-cascade", file: "migration.sql", lineStart: 6, lineEnd: 6, severity: "P1", evidence: "" })]));
    expect(score.passed).toBe(true);
  });
});

describe("aggregateScores", () => {
  it("computes precision/recall/duplicate rate across a small suite", () => {
    const scores = [
      scoreFixture(missingFk, result([finding({ evidence: "" })])),
      scoreFixture(safeMigration, result([])),
      scoreFixture(raceCondition, result([])),
    ];
    const suite = aggregateScores(scores);
    expect(suite.fixturesRun).toBe(3);
    expect(suite.recall).toBeCloseTo(0.5, 5); // 1 of 2 required findings detected (missingFk yes, raceCondition no)
    expect(suite.duplicateRate).toBe(0);
  });

  it("categoryAccuracyRate is vacuously 1 when no matched_required findings exist", () => {
    const suite = aggregateScores([scoreFixture(safeMigration, result([]))]);
    expect(suite.categoryAccuracyRate).toBe(1);
  });
});
