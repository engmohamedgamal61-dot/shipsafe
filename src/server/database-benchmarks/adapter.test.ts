import { describe, expect, it } from "vitest";
import type { Finding as PersistedFinding } from "@/domain/types";
import { AdapterValidationError, adaptPersistedFindings } from "./adapter";

function persistedFinding(overrides: Partial<PersistedFinding> = {}): PersistedFinding {
  return {
    id: "finding-1",
    reviewerRunId: "run-1",
    severity: "P1",
    title: "Missing foreign key",
    description: "repository_id uuid not null has no references clause.",
    filePath: "migration.sql",
    lineStart: 5,
    lineEnd: 5,
    category: "foreign-keys",
    recommendation: "Add references public.repositories (id) on delete cascade.",
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
    [0.5, "medium"],
    [0.8, "high"],
  ] as const)("buckets numeric confidence %s -> %s", (confidence, expectedBucket) => {
    const result = adaptPersistedFindings([persistedFinding({ confidence })]);
    expect(result.findings[0]?.confidence).toBe(expectedBucket);
  });

  it("preserves file, line, category, and maps description -> evidence", () => {
    const result = adaptPersistedFindings([persistedFinding({ filePath: "src/foo.sql", lineStart: 3, lineEnd: 9, category: "performance", description: "quoted code" })]);
    const [finding] = result.findings;
    expect(finding).toMatchObject({ file: "src/foo.sql", lineStart: 3, lineEnd: 9, category: "performance", evidence: "quoted code" });
  });

  it("never invents a ruleId", () => {
    const result = adaptPersistedFindings([persistedFinding()]);
    expect(result.findings[0]?.ruleId).toBeUndefined();
  });

  it("always sets needsMoreContext to false", () => {
    const result = adaptPersistedFindings([persistedFinding()]);
    expect(result.needsMoreContext).toBe(false);
  });

  it("returns an empty findings list for an empty input", () => {
    expect(adaptPersistedFindings([]).findings).toEqual([]);
  });

  it("passes filePath: null through as file: null", () => {
    const result = adaptPersistedFindings([persistedFinding({ filePath: null, lineStart: null, lineEnd: null })]);
    expect(result.findings[0]).toMatchObject({ file: null, lineStart: null, lineEnd: null });
  });

  it("fails validation rather than guessing when lineStart is set but filePath is null", () => {
    expect(() => adaptPersistedFindings([persistedFinding({ filePath: null, lineStart: 5, lineEnd: 5 })])).toThrow(AdapterValidationError);
  });

  it("fails validation rather than clamping an out-of-range confidence", () => {
    expect(() => adaptPersistedFindings([persistedFinding({ confidence: 1.5 })])).toThrow(AdapterValidationError);
    expect(() => adaptPersistedFindings([persistedFinding({ confidence: -0.1 })])).toThrow(AdapterValidationError);
  });

  it("reports every malformed finding's index, not just the first", () => {
    let caught: unknown;
    try {
      adaptPersistedFindings([persistedFinding({ filePath: null, lineStart: 5, lineEnd: 5 }), persistedFinding(), persistedFinding({ confidence: 2 })]);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AdapterValidationError);
    expect((caught as AdapterValidationError).errors.map((e) => e.index)).toEqual([0, 2]);
  });

  it("adapts multiple valid findings in order", () => {
    const result = adaptPersistedFindings([persistedFinding({ id: "a", filePath: "a.sql" }), persistedFinding({ id: "b", filePath: "b.sql" })]);
    expect(result.findings.map((f) => f.file)).toEqual(["a.sql", "b.sql"]);
  });
});
