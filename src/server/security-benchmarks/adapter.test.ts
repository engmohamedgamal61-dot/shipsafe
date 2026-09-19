import { describe, expect, it } from "vitest";
import type { Finding as PersistedFinding } from "@/domain/types";
import { AdapterValidationError, adaptPersistedFindings } from "./adapter";

function persistedFinding(overrides: Partial<PersistedFinding> = {}): PersistedFinding {
  return {
    id: "finding-1",
    reviewerRunId: "run-1",
    severity: "P0",
    title: "Missing ownership check",
    description: "const supabase = createServiceSupabaseClient();",
    filePath: "route.ts",
    lineStart: 8,
    lineEnd: 14,
    category: "access-control",
    recommendation: "Use the session-scoped client.",
    confidence: 0.9,
    ...overrides,
  };
}

describe("adaptPersistedFindings", () => {
  it("maps NIT -> Nit", () => {
    const result = adaptPersistedFindings([persistedFinding({ severity: "NIT" })]);
    expect(result.findings[0]?.severity).toBe("Nit");
  });

  it.each([
    ["P0", "P0"],
    ["P1", "P1"],
    ["P2", "P2"],
  ] as const)("passes %s through unchanged", (input, expected) => {
    const result = adaptPersistedFindings([persistedFinding({ severity: input })]);
    expect(result.findings[0]?.severity).toBe(expected);
  });

  it.each([
    [0.0, "low"],
    [0.49, "low"],
    [0.5, "medium"],
    [0.79, "medium"],
    [0.8, "high"],
    [1.0, "high"],
  ] as const)("buckets numeric confidence %s -> %s (canonical thresholds)", (confidence, expectedBucket) => {
    const result = adaptPersistedFindings([persistedFinding({ confidence })]);
    expect(result.findings[0]?.confidence).toBe(expectedBucket);
  });

  it("preserves file, line, category, and maps description -> evidence", () => {
    const result = adaptPersistedFindings([
      persistedFinding({
        filePath: "src/route.ts",
        lineStart: 3,
        lineEnd: 9,
        category: "access-control",
        description: "the exact quoted code",
      }),
    ]);
    const [finding] = result.findings;
    expect(finding).toMatchObject({
      file: "src/route.ts",
      lineStart: 3,
      lineEnd: 9,
      category: "access-control",
      evidence: "the exact quoted code",
    });
  });

  it("never invents a ruleId — it is always absent on adapted output", () => {
    const result = adaptPersistedFindings([persistedFinding()]);
    expect(result.findings[0]?.ruleId).toBeUndefined();
  });

  it("always sets needsMoreContext to false — production has no such signal to adapt", () => {
    const result = adaptPersistedFindings([persistedFinding()]);
    expect(result.needsMoreContext).toBe(false);
  });

  it("returns an empty findings list for an empty input", () => {
    const result = adaptPersistedFindings([]);
    expect(result.findings).toEqual([]);
  });

  it("passes filePath: null through as file: null (a real, currently-active production behavior — see prompt.ts)", () => {
    const result = adaptPersistedFindings([
      persistedFinding({
        filePath: null,
        lineStart: null,
        lineEnd: null,
        description: "No branch protection rule requires this check anywhere in the repository configuration.",
      }),
    ]);
    expect(result.findings[0]).toMatchObject({ file: null, lineStart: null, lineEnd: null });
  });

  it("fails validation rather than guessing when lineStart is set but filePath is null (malformed combination)", () => {
    expect(() =>
      adaptPersistedFindings([persistedFinding({ filePath: null, lineStart: 5, lineEnd: 5 })]),
    ).toThrow(AdapterValidationError);
  });

  it("fails validation rather than clamping an out-of-range confidence", () => {
    expect(() => adaptPersistedFindings([persistedFinding({ confidence: 1.5 })])).toThrow(AdapterValidationError);
    expect(() => adaptPersistedFindings([persistedFinding({ confidence: -0.1 })])).toThrow(AdapterValidationError);
  });

  it("reports every malformed finding's index, not just the first", () => {
    let caught: unknown;
    try {
      adaptPersistedFindings([
        persistedFinding({ filePath: null, lineStart: 5, lineEnd: 5 }),
        persistedFinding(),
        persistedFinding({ confidence: 2 }),
      ]);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AdapterValidationError);
    expect((caught as AdapterValidationError).errors.map((e) => e.index)).toEqual([0, 2]);
  });

  it("never invents evidenceState/securityConsequence/attackPreconditions/exploitScenario/standards — all five are absent on adapted output (Task 1/2)", () => {
    const result = adaptPersistedFindings([persistedFinding()]);
    const [adapted] = result.findings;
    expect(adapted?.evidenceState).toBeUndefined();
    expect(adapted?.securityConsequence).toBeUndefined();
    expect(adapted?.attackPreconditions).toBeUndefined();
    expect(adapted?.exploitScenario).toBeUndefined();
    expect(adapted?.standards).toBeUndefined();
  });

  it("adapts multiple valid findings in order", () => {
    const result = adaptPersistedFindings([
      persistedFinding({ id: "a", filePath: "a.ts" }),
      persistedFinding({ id: "b", filePath: "b.ts" }),
    ]);
    expect(result.findings.map((f) => f.file)).toEqual(["a.ts", "b.ts"]);
  });
});
