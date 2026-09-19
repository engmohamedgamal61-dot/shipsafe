import { describe, expect, it } from "vitest";
import type { ProviderFinding } from "@/domain/schemas";
import type { ReviewContext } from "../types";
import {
  canonicalizeCategory,
  capInflatedSeverity,
  downgradeUnseenTestContextConfidence,
  mergeDuplicateFindings,
  normalizeTestOutput,
  redactUnverifiableQuotes,
} from "./test-normalization";

function finding(overrides: Partial<ProviderFinding> = {}): ProviderFinding {
  return {
    severity: "P1",
    title: "Finding",
    description: "Some description.",
    filePath: "score.test.ts",
    lineStart: 5,
    lineEnd: 8,
    category: "testing",
    recommendation: "Fix it.",
    confidence: 0.9,
    ...overrides,
  };
}

function diffContext(fileContents: Record<string, string[]>): ReviewContext {
  const diffText = Object.entries(fileContents)
    .map(([path, lines]) => [`diff --git a/${path} b/${path}`, "new file mode 100644", "--- /dev/null", `+++ b/${path}`, `@@ -0,0 +1,${lines.length} @@`, ...lines.map((l) => `+${l}`)].join("\n"))
    .join("\n");
  return {
    pullRequestTitle: "PR",
    sourceBranch: "feature",
    targetBranch: "main",
    changedFiles: Object.keys(fileContents).map((path) => ({ path, status: "added", additions: fileContents[path].length, deletions: 0 })),
    diffText,
    diffTruncated: false,
    changedFilesTruncated: false,
  };
}

describe("normalizeTestOutput — speculative coverage gaps dropped", () => {
  const context = diffContext({ "score.test.ts": ["it('sums', () => { expect(totalReviewScore([1, 2, 3])).toBe(6); });"] });

  it("adequate comprehensive suite should not get a speculative floating-point/non-array finding", () => {
    const output = normalizeTestOutput(
      {
        summary: "s",
        findings: [
          finding({
            description:
              "There are no tests verifying behavior when totalReviewScore is called with null, undefined, or a non-array argument. If the implementation is meant to handle these gracefully, a regression could go unnoticed.",
          }),
        ],
      },
      context,
    );
    expect(output.findings).toEqual([]);
  });

  it("drops a floating-point-precision speculative finding", () => {
    const output = normalizeTestOutput(
      {
        summary: "s",
        findings: [
          finding({
            description: "Floating-point summation and large arrays are not tested, which could hide precision or performance issues in the underlying implementation.",
          }),
        ],
      },
      context,
    );
    expect(output.findings).toEqual([]);
  });

  it("keeps a finding about a CURRENT, concretely demonstrated failure mode (empty array)", () => {
    const output = normalizeTestOutput(
      {
        summary: "s",
        findings: [
          finding({
            description: "totalReviewScore throws on an empty array via Array.prototype.reduce with no initial value, and there is no test for this case.",
          }),
        ],
      },
      context,
    );
    expect(output.findings).toHaveLength(1);
  });
});

describe("normalizeTestOutput — self-doubting speculative findings dropped", () => {
  const context = diffContext({ "staleness.test.ts": ["expect(isStale(NOW)).toBe(false);"] });

  it("drops a finding that hedges on unseen context AND doubts its own relevance", () => {
    const output = normalizeTestOutput(
      {
        summary: "s",
        findings: [
          finding({
            filePath: "staleness.test.ts",
            description: "The staleness threshold constant is not shown in this diff, so it's unclear whether this boundary is a meaningful risk or already covered elsewhere.",
          }),
        ],
      },
      context,
    );
    expect(output.findings).toEqual([]);
  });

  it("drops a finding using the 'may not matter' phrasing of self-doubt", () => {
    const output = normalizeTestOutput(
      {
        summary: "s",
        findings: [
          finding({
            filePath: "staleness.test.ts",
            description: "Without seeing the constant this depends on, this gap may not matter in practice.",
          }),
        ],
      },
      context,
    );
    expect(output.findings).toEqual([]);
  });

  it("keeps a finding that hedges on unseen context but does NOT doubt its own relevance", () => {
    const output = normalizeTestOutput(
      {
        summary: "s",
        findings: [
          finding({
            filePath: "staleness.test.ts",
            confidence: 0.7,
            description: "Whether this boundary is covered cannot be confirmed without seeing the sibling test file, but the missing case is clearly significant if untested.",
          }),
        ],
      },
      context,
    );
    expect(output.findings).toHaveLength(1);
    expect(output.findings[0]?.confidence).toBeLessThan(0.5);
  });
});

describe("downgradeUnseenTestContextConfidence (ambiguity/unseen-test discipline)", () => {
  it("unseen test context -> low confidence: caps confidence when acknowledging tests may exist outside the diff", () => {
    const f = finding({ confidence: 0.7, description: "No test file is included in this diff, so whether coverage already exists elsewhere cannot be confirmed." });
    expect(downgradeUnseenTestContextConfidence(f).confidence).toBeLessThan(0.5);
  });

  it("caps confidence for 'not part of the change set' hedging", () => {
    const f = finding({ confidence: 0.9, description: "The production file is not part of the change set, so this cannot be confirmed either way." });
    expect(downgradeUnseenTestContextConfidence(f).confidence).toBeLessThan(0.5);
  });

  it("never raises confidence — a finding already below the cap is left untouched", () => {
    const f = finding({ confidence: 0.1, description: "Depending on unseen tests, this may or may not be covered." });
    expect(downgradeUnseenTestContextConfidence(f).confidence).toBe(0.1);
  });

  it("leaves a confidently and concretely demonstrated finding's confidence untouched", () => {
    const f = finding({ confidence: 0.9, description: "The assertion expect(result).toBeDefined() can never fail because the function always returns a boolean." });
    expect(downgradeUnseenTestContextConfidence(f).confidence).toBe(0.9);
  });
});

describe("capInflatedSeverity (severity calibration)", () => {
  it("severity inflation prevented: an unjustified P0 is capped to P1", () => {
    const f = finding({ severity: "P0", description: "This test only asserts toBeDefined(), which is a weak assertion." });
    expect(capInflatedSeverity(f).severity).toBe("P1");
  });

  it("keeps P0 when the description itself states a realistic severe-regression path", () => {
    const f = finding({ severity: "P0", description: "Because this assertion is never awaited, a broken auth check could silently ship as an undetected regression." });
    expect(capInflatedSeverity(f).severity).toBe("P0");
  });

  it("never touches P1/P2/Nit", () => {
    expect(capInflatedSeverity(finding({ severity: "P1" })).severity).toBe("P1");
    expect(capInflatedSeverity(finding({ severity: "P2" })).severity).toBe("P2");
    expect(capInflatedSeverity(finding({ severity: "NIT" })).severity).toBe("NIT");
  });
});

describe("redactUnverifiableQuotes (evidence precision)", () => {
  const context = diffContext({
    "attach-review-status.test.ts": ["vi.mock('@/lib/supabase/service', () => ({", "  createServiceSupabaseClient: () => ({", "    from: () => ({ select: () => ({ in: () => ({ data: [], error: null }) }) }),", "  }),", "}));"],
  });

  it("a hypothetical real-integration API call is not treated as literal evidence", () => {
    const f = finding({
      filePath: "attach-review-status.test.ts",
      description: "The real query actually needs `.in('pull_request_id', [])`, which the mock never exercises with real arguments.",
    });
    const result = redactUnverifiableQuotes(f, context);
    expect(result.description).not.toContain("pull_request_id");
    expect(result.description).toContain("[unverified quote removed]");
  });

  it("a paraphrased mock-return shape is not treated as literal evidence", () => {
    const f = finding({ filePath: "attach-review-status.test.ts", description: "The mock's chain ultimately returns `{data, error}` without matching the real client's shape." });
    const result = redactUnverifiableQuotes(f, context);
    expect(result.description).toContain("[unverified quote removed]");
  });

  it("a verifiable method-chain reference is left untouched", () => {
    const f = finding({ filePath: "attach-review-status.test.ts", description: "The mock only implements `select().in()`." });
    expect(redactUnverifiableQuotes(f, context).description).toBe(f.description);
  });

  it("never drops the finding itself for one bad quote", () => {
    const f = finding({ filePath: "attach-review-status.test.ts", description: "Calls `.order()` which is fabricated." });
    const result = redactUnverifiableQuotes(f, context);
    expect(result.severity).toBe(f.severity);
    expect(result.category).toBe(f.category);
  });
});

describe("mergeDuplicateFindings (same root cause merges to one finding)", () => {
  it("two findings restating the same missing-await defect from different angles merge into one", () => {
    const findings = [
      finding({ lineStart: 5, lineEnd: 7, description: "The rejects assertion is never awaited." }),
      finding({ lineStart: 5, lineEnd: 7, category: "test-quality", description: "Because the promise is unawaited, the test always reports passing." }),
    ];
    expect(mergeDuplicateFindings(findings)).toHaveLength(1);
  });

  it("keeps genuinely distinct, non-overlapping root causes separate", () => {
    const findings = [
      finding({ lineStart: 5, lineEnd: 7, description: "Missing await on the rejects assertion." }),
      finding({ lineStart: 20, lineEnd: 22, description: "A completely unrelated weak assertion exists elsewhere in the file." }),
    ];
    expect(mergeDuplicateFindings(findings)).toHaveLength(2);
  });
});

describe("canonicalizeCategory (category discipline)", () => {
  it("testing -> async-mistakes.missing-await", () => {
    const f = finding({ category: "testing", description: "The rejects assertion is used without await, so the test never actually verifies the rejection." });
    expect(canonicalizeCategory(f).category).toBe("async-mistakes.missing-await");
  });

  it("test-coverage -> brittle-tests.implementation-coupling", () => {
    const f = finding({ category: "test-coverage", description: "The test spies on an internal helper and asserts only the call count, an implementation detail." });
    expect(canonicalizeCategory(f).category).toBe("brittle-tests.implementation-coupling");
  });

  it("test_quality -> mock-fidelity.hides-real-contract", () => {
    const f = finding({ category: "test_quality", description: "The mock is hand-crafted to match the code's own expectations rather than the real Supabase contract." });
    expect(canonicalizeCategory(f).category).toBe("mock-fidelity.hides-real-contract");
  });

  it("weak-assertions -> weak-assertions.tautological", () => {
    const f = finding({ category: "weak-assertions", description: "The toBeDefined() assertion proves nothing and can never fail." });
    expect(canonicalizeCategory(f).category).toBe("weak-assertions.tautological");
  });

  it("review-context -> duplicated-tests.redundant-coverage", () => {
    const f = finding({ category: "review-context", description: "These three tests are identical in code path and add no real confidence beyond the first." });
    expect(canonicalizeCategory(f).category).toBe("duplicated-tests.redundant-coverage");
  });

  it("testing -> missing-error-path.untested-failure-mode", () => {
    const f = finding({ category: "testing", description: "Only the happy path is tested; there is no test for the empty-array error case." });
    expect(canonicalizeCategory(f).category).toBe("missing-error-path.untested-failure-mode");
  });

  it("test-coverage -> missing-tests.critical-behavior", () => {
    const f = finding({ category: "test-coverage", description: "This critical policy function was added with no test file at all." });
    expect(canonicalizeCategory(f).category).toBe("missing-tests.critical-behavior");
  });

  it("never reclassifies into an unrelated domain when the signature doesn't match", () => {
    const f = finding({ category: "testing", description: "This test file is a bit long and could be split up." });
    expect(canonicalizeCategory(f).category).toBe("testing");
  });
});

describe("normalizeTestOutput (full pipeline) — true positives survive", () => {
  it("a genuine missing-await finding survives and is canonicalized", () => {
    const context = diffContext({ "ingest.test.ts": ["expect(ingestPullRequest(null)).rejects.toThrow();"] });
    const output = normalizeTestOutput(
      {
        summary: "s",
        findings: [
          finding({
            category: "testing",
            filePath: "ingest.test.ts",
            lineStart: 1,
            lineEnd: 1,
            confidence: 0.9,
            description: "The rejects assertion is used without await, so the test always reports passing regardless of whether ingestPullRequest actually rejects.",
          }),
        ],
      },
      context,
    );
    expect(output.findings).toHaveLength(1);
    expect(output.findings[0]?.category).toBe("async-mistakes.missing-await");
    expect(output.findings[0]?.confidence).toBe(0.9);
  });

  it("a genuine weak-assertion finding survives and is canonicalized", () => {
    const context = diffContext({ "verdict.test.ts": ["expect(result).toBeDefined();"] });
    const output = normalizeTestOutput(
      {
        summary: "s",
        findings: [
          finding({
            category: "weak-assertions",
            filePath: "verdict.test.ts",
            lineStart: 1,
            lineEnd: 1,
            confidence: 0.85,
            description: "The toBeDefined() assertion proves nothing since the function always returns a boolean and can never fail.",
          }),
        ],
      },
      context,
    );
    expect(output.findings).toHaveLength(1);
    expect(output.findings[0]?.category).toBe("weak-assertions.tautological");
  });

  it("a genuine mock-fidelity finding survives and is canonicalized", () => {
    const context = diffContext({ "attach-review-status.test.ts": ["createServiceSupabaseClient: () => ({ from: () => ({}) })"] });
    const output = normalizeTestOutput(
      {
        summary: "s",
        findings: [
          finding({
            category: "test-quality",
            filePath: "attach-review-status.test.ts",
            lineStart: 1,
            lineEnd: 1,
            confidence: 0.8,
            description: "The mock is hand-crafted to match what the code expects rather than modeling the real Supabase client's contract.",
          }),
        ],
      },
      context,
    );
    expect(output.findings).toHaveLength(1);
    expect(output.findings[0]?.category).toBe("mock-fidelity.hides-real-contract");
  });

  it("a genuine missing-error-path finding survives and is canonicalized", () => {
    const context = diffContext({ "score.test.ts": ["expect(totalReviewScore([1, 2, 3])).toBe(6);"] });
    const output = normalizeTestOutput(
      {
        summary: "s",
        findings: [
          finding({
            category: "testing",
            filePath: "score.test.ts",
            lineStart: 1,
            lineEnd: 1,
            confidence: 0.85,
            description: "Only the happy path is tested; there is no test covering the empty-array case, which the current implementation throws on.",
          }),
        ],
      },
      context,
    );
    expect(output.findings).toHaveLength(1);
    expect(output.findings[0]?.category).toBe("missing-error-path.untested-failure-mode");
  });

  it("out-of-lane production-code finding is dropped end-to-end", () => {
    const context = diffContext({ "score.ts": ["export function totalReviewScore(scores) { return scores.reduce((a, b) => a + b); }"] });
    const output = normalizeTestOutput(
      { summary: "s", findings: [finding({ category: "correctness", filePath: "score.ts", description: "This reduce() call throws on an empty array." })] },
      context,
    );
    expect(output.findings).toEqual([]);
  });

  it("never increases the number of findings", () => {
    const context = diffContext({ "x.test.ts": ["it('x', () => {});"] });
    const raw = [finding({ filePath: "x.test.ts", lineStart: 1, lineEnd: 1 }), finding({ filePath: "x.test.ts", lineStart: 1, lineEnd: 1 })];
    const output = normalizeTestOutput({ summary: "s", findings: raw }, context);
    expect(output.findings.length).toBeLessThanOrEqual(raw.length);
  });

  it("preserves the summary field untouched", () => {
    const context = diffContext({ "x.test.ts": ["it('x', () => {});"] });
    const output = normalizeTestOutput({ summary: "original summary", findings: [] }, context);
    expect(output.summary).toBe("original summary");
  });
});
