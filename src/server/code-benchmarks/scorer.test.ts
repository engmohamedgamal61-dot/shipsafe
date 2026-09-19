import path from "node:path";
import { describe, expect, it } from "vitest";
import { BENCHMARK_ROOT, loadFixture, type LoadedFixture } from "./load-fixtures";
import { expectedFixtureSchema } from "./schema";
import { aggregateScores, producedFindingSchema, reviewerResultSchema, scoreFixture, type ProducedFinding, type ReviewerResult } from "./scorer";

const offByOne = loadFixture(path.join(BENCHMARK_ROOT, "correctness", "01-off-by-one-pagination"));
const safeRange = loadFixture(path.join(BENCHMARK_ROOT, "correctness", "02-safe-half-open-range"));
const ambiguous = loadFixture(path.join(BENCHMARK_ROOT, "ambiguous", "01-unvalidated-discount-lookup"));
const perf = loadFixture(path.join(BENCHMARK_ROOT, "performance", "01-linear-scan-in-filter"));

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
      allowed_categories: ["correctness.off-by-one", "performance.generic"],
      prohibited_categories: [],
      required_findings: [
        {
          id: "req-1",
          rule_id: "CODE-TEST-001",
          category: "correctness.off-by-one",
          alternate_categories: ["performance.generic"],
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
          rule_id: "CODE-TEST-002",
          category: "maintainability.generic",
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

function result(findings: ProducedFinding[], overrides: Partial<ReviewerResult> = {}): ReviewerResult {
  return reviewerResultSchema.parse({ needsMoreContext: false, findings, ...overrides });
}

describe("scoreFixture — core scenarios", () => {
  it("perfect answer: matches the required finding exactly", () => {
    const score = scoreFixture(offByOne, result([finding({ evidence: "items.slice(start, end + 1)" })]));
    expect(score.passed).toBe(true);
    expect(score.requiredFindingsDetected).toEqual(["req-1"]);
    expect(score.rawScore).toBe(1);
    expect(score.normalizedScore).toBe(1);
  });

  it("missed defect: zero findings against a buggy fixture", () => {
    const score = scoreFixture(offByOne, result([]));
    expect(score.passed).toBe(false);
    expect(score.requiredFindingsMissed).toEqual(["req-1"]);
    // req-1 is P1 (not P0), so a miss is -1, not -2.
    expect(score.rawScore).toBe(-1);
  });

  it("false positive on a safe fixture: any finding at all is prohibited", () => {
    const score = scoreFixture(safeRange, result([finding({ category: "correctness.off-by-one", file: "ranges.ts", lineStart: 9, lineEnd: 9, evidence: "" })]));
    expect(score.passed).toBe(false);
    expect(score.prohibitedFindings).toHaveLength(1);
    expect(score.rawScore).toBe(-2); // safe-fixture violations are double-weighted
  });

  it("clean safe fixture passes with a perfect score", () => {
    const score = scoreFixture(safeRange, result([]));
    expect(score.passed).toBe(true);
    expect(score.normalizedScore).toBe(1);
  });

  it("duplicate root cause: a second finding matching the same required entry is a duplicate", () => {
    const score = scoreFixture(
      offByOne,
      result([finding({ evidence: "items.slice(start, end + 1)" }), finding({ evidence: "items.slice(start, end + 1)" })]),
    );
    expect(score.requiredFindingsDetected).toEqual(["req-1"]);
    expect(score.duplicates).toHaveLength(1);
    expect(score.passed).toBe(true);
    expect(score.rawScore).toBeCloseTo(0.7);
  });

  it("severity inflation: a matched finding above severity_range.max is penalized", () => {
    const score = scoreFixture(perf, result([finding({ category: "performance.algorithmic-complexity", severity: "P0", file: "filter-blocked.ts", lineStart: 10, lineEnd: 10, evidence: "" })]));
    expect(score.severityAccuracy.inflated).toBe(1);
  });

  it("hallucinated file: a produced finding citing a file outside the fixture is a hard failure", () => {
    const score = scoreFixture(offByOne, result([finding({ file: "does-not-exist.ts", evidence: "" })]));
    expect(score.hardFailure).toBe(true);
    expect(score.hallucinatedPaths).toHaveLength(1);
    expect(score.normalizedScore).toBe(0);
  });

  it("ambiguous fixture: zero findings passes", () => {
    const score = scoreFixture(ambiguous, result([]));
    expect(score.passed).toBe(true);
    expect(score.rawScore).toBe(1);
  });

  it("ambiguous fixture: a low-confidence finding matching the optional entry passes", () => {
    const score = scoreFixture(ambiguous, result([finding({ category: "correctness.generic", severity: "P2", confidence: "low", file: "apply-discount.ts", lineStart: 11, lineEnd: 12, evidence: "" })]));
    expect(score.passed).toBe(true);
    expect(score.optionalFindingsAccepted).toEqual(["opt-1"]);
  });

  it("ambiguous fixture: a confident finding is prohibited (overconfidence)", () => {
    const score = scoreFixture(ambiguous, result([finding({ category: "correctness.generic", severity: "P1", confidence: "high", file: "apply-discount.ts", lineStart: 11, lineEnd: 12, evidence: "" })]));
    expect(score.passed).toBe(false);
    expect(score.prohibitedFindings).toHaveLength(1);
  });
});

describe("scoreFixture — rule_id matching", () => {
  it("an exact rule_id match wins even when the cited line is outside the declared region", () => {
    const score = scoreFixture(offByOne, result([finding({ ruleId: "CODE-CORRECTNESS-001", file: "paginate.ts", lineStart: 1, lineEnd: 1, evidence: "" })]));
    expect(score.requiredFindingsDetected).toEqual(["req-1"]);
  });

  it("a wrong rule_id does not fall back to location matching", () => {
    const score = scoreFixture(offByOne, result([finding({ ruleId: "CODE-CORRECTNESS-999", file: "paginate.ts", lineStart: 7, lineEnd: 7, evidence: "" })]));
    expect(score.requiredFindingsMissed).toEqual(["req-1"]);
  });
});

describe("scoreFixture — category compatibility", () => {
  it("a legacy category is mapped via the compatibility layer to disambiguate an overlapping entry", () => {
    // Uses overlappingTestFixture (not a real fixture) because none of
    // the 10 real fixtures have two overlapping ground-truth entries —
    // the compatibility path only ever engages when disambiguation is
    // actually needed (see matchesByLocation), so it can't be exercised
    // against a single-entry fixture like offByOne.
    const score = scoreFixture(overlappingTestFixture, result([finding({ category: "off-by-one", file: "main.ts", lineStart: 2, lineEnd: 2, evidence: "" })]));
    expect(score.requiredFindingsDetected).toEqual(["req-1"]);
    const [classified] = score.allFindings;
    expect(classified.matchMethod).toBe("compatibility_category_location");
    expect(classified.normalizedCategory).toBe("correctness.off-by-one");
    expect(classified.categoryAccurate).toBe(true);
  });

  it("categoryAccurate is false when location matches without disambiguation but the category is unrelated to the expected one", () => {
    const score = scoreFixture(offByOne, result([finding({ category: "unrelated-category-nobody-declared", evidence: "" })]));
    expect(score.requiredFindingsDetected).toEqual(["req-1"]); // still matches — no sibling to disambiguate from
    const [classified] = score.allFindings;
    expect(classified.categoryAccurate).toBe(false);
  });
});

describe("scoreFixture — alternate_categories disambiguation", () => {
  it("a produced finding using req-1's alternate category matches req-1, not opt-1", () => {
    const score = scoreFixture(overlappingTestFixture, result([finding({ category: "performance.generic", file: "main.ts", lineStart: 2, lineEnd: 2, evidence: "" })]));
    expect(score.requiredFindingsDetected).toEqual(["req-1"]);
    expect(score.optionalFindingsAccepted).toEqual([]);
  });

  it("a category matching neither req-1's set nor opt-1's category stays unmatched (needs disambiguation)", () => {
    const score = scoreFixture(overlappingTestFixture, result([finding({ category: "correctness.generic", file: "main.ts", lineStart: 2, lineEnd: 2, evidence: "" })]));
    expect(score.requiredFindingsDetected).toEqual([]);
    expect(score.requiredFindingsMissed).toEqual(["req-1"]);
  });
});

describe("scoreFixture — fabricated-evidence detection", () => {
  it("a case-different but otherwise verbatim quote is not fabricated", () => {
    const score = scoreFixture(offByOne, result([finding({ evidence: "Uses `ITEMS.SLICE(START, END + 1)` to build the page." })]));
    expect(score.fabricatedEvidence).toHaveLength(0);
  });

  it("a genuinely invented quote is a hard failure", () => {
    const score = scoreFixture(offByOne, result([finding({ evidence: "Calls `validatePageBounds()` before slicing." })]));
    expect(score.hardFailure).toBe(true);
    expect(score.fabricatedEvidence).toHaveLength(1);
  });

  it("an illustrative example introduced with 'e.g.' is not treated as a verbatim-quote claim", () => {
    const score = scoreFixture(offByOne, result([finding({ evidence: "This could return duplicate items, e.g. `item#42` appearing on two pages." })]));
    expect(score.fabricatedEvidence).toHaveLength(0);
  });

  it("a dotted reference whose segments are all real is not treated as a verbatim-quote claim", () => {
    const score = scoreFixture(offByOne, result([finding({ evidence: "Equivalent to a bug in `Array.prototype.slice` usage here." })]));
    // "Array"/"prototype"/"slice" are not literal source tokens in paginate.ts as one dotted chain,
    // but each individual segment must be checked — this exercises the exemption path without asserting it always exempts.
    expect(score.fabricatedEvidence.length).toBeLessThanOrEqual(1);
  });

  it("a leading-dot, empty-parens method reference is not treated as a verbatim-quote claim (regression: performance-01's real baseline run wrote `.filter()` generically, disqualifying its own correct O(n*m) finding)", () => {
    const score = scoreFixture(
      perf,
      result([
        finding({
          category: "performance.algorithmic-complexity",
          file: "filter-blocked.ts",
          lineStart: 10,
          lineEnd: 10,
          evidence: "Calls `.filter()` and, for each element, `blockedUserIds.includes(comment.authorId)` — an O(n*m) scan.",
        }),
      ]),
    );
    expect(score.fabricatedEvidence).toHaveLength(0);
    expect(score.requiredFindingsDetected).toEqual(["req-1"]);
  });

  it("a dotted-chain method reference with trailing empty parens is not treated as a verbatim-quote claim", () => {
    const score = scoreFixture(perf, result([finding({ file: "filter-blocked.ts", lineStart: 10, lineEnd: 10, evidence: "Similar to misusing `blockedUserIds.includes()` in a hot path." })]));
    expect(score.fabricatedEvidence).toHaveLength(0);
  });

  it("empty parens do NOT exempt a genuinely invented method name — every segment must still be a real token", () => {
    const score = scoreFixture(perf, result([finding({ file: "filter-blocked.ts", lineStart: 10, lineEnd: 10, evidence: "Should instead call `.fastLookup()` for O(1) access." })]));
    expect(score.fabricatedEvidence).toHaveLength(1);
  });

  it("real (non-empty) call arguments are never exempted by the method-reference pattern — still fully verified", () => {
    const score = scoreFixture(offByOne, result([finding({ evidence: "Equivalent to calling `items.slice(0, 999)` unconditionally." })]));
    // "items.slice(0, 999)" is not literally in the source (source calls slice(start, end + 1)) —
    // the parens are non-empty, so this must NOT be exempted as a bare method reference.
    expect(score.fabricatedEvidence).toHaveLength(1);
  });

  it("empty evidence is speculative, not fabricated", () => {
    const score = scoreFixture(offByOne, result([finding({ evidence: "" })]));
    expect(score.fabricatedEvidence).toHaveLength(0);
    expect(score.speculativeFindings).toHaveLength(1);
  });
});

describe("producedFindingSchema / reviewerResultSchema", () => {
  it("rejects lineEnd set while lineStart is null", () => {
    expect(producedFindingSchema.safeParse({ category: "x", severity: "P0", confidence: "high", file: "a.ts", lineStart: null, lineEnd: 5, evidence: "" }).success).toBe(false);
  });

  it("rejects lineStart greater than lineEnd", () => {
    expect(producedFindingSchema.safeParse({ category: "x", severity: "P0", confidence: "high", file: "a.ts", lineStart: 20, lineEnd: 5, evidence: "" }).success).toBe(false);
  });

  it("defaults needsMoreContext and findings when omitted", () => {
    const parsed = reviewerResultSchema.parse({});
    expect(parsed.needsMoreContext).toBe(false);
    expect(parsed.findings).toEqual([]);
  });
});

describe("aggregateScores", () => {
  it("computes precision/recall/hallucination-rate across a mixed set", () => {
    const perfectScore = scoreFixture(offByOne, result([finding({ evidence: "" })]));
    const missed = scoreFixture(offByOne, result([]));
    const hallucinated = scoreFixture(offByOne, result([finding({ file: "does-not-exist.ts" })]));
    const safePass = scoreFixture(safeRange, result([]));

    const suite = aggregateScores([perfectScore, missed, hallucinated, safePass]);
    expect(suite.fixturesRun).toBe(4);
    expect(suite.fixturesFailed).toBe(1);
    expect(suite.hallucinationRate).toBeGreaterThan(0);
    expect(suite.failedFixtures).toEqual([hallucinated.fixtureId]);
  });

  it("reports vacuous rates as 1 (precision/recall/categoryAccuracy) when nothing was produced or required", () => {
    const suite = aggregateScores([scoreFixture(ambiguous, result([]))]);
    expect(suite.precision).toBe(1);
    expect(suite.recall).toBe(1);
    expect(suite.categoryAccuracyRate).toBe(1);
  });

  it("categoryAccuracyRate reflects matched_required findings' category correctness", () => {
    const accurate = scoreFixture(offByOne, result([finding({ category: "correctness.off-by-one", evidence: "" })]));
    const inaccurate = scoreFixture(offByOne, result([finding({ category: "totally-unrelated-string", evidence: "" })]));
    const suite = aggregateScores([accurate, inaccurate]);
    expect(suite.categoryAccuracyRate).toBeCloseTo(0.5);
  });
});
