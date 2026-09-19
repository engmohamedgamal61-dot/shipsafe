import { describe, expect, it } from "vitest";
import {
  BENCHMARK_DATASET_VERSION,
  BENCHMARK_SCHEMA_VERSION,
  REVIEWER_PROMPT_VERSION,
  SECURITY_TAXONOMY_VERSION,
} from "./versions";

describe("benchmark version constants (Task 3)", () => {
  it("every constant is a non-empty, deterministic string", () => {
    for (const value of [SECURITY_TAXONOMY_VERSION, BENCHMARK_SCHEMA_VERSION, BENCHMARK_DATASET_VERSION, REVIEWER_PROMPT_VERSION]) {
      expect(typeof value).toBe("string");
      expect(value.length).toBeGreaterThan(0);
    }
  });

  it("SECURITY_TAXONOMY_VERSION matches the spec's own date-based scheme and current value", () => {
    expect(SECURITY_TAXONOMY_VERSION).toBe("2026.09.19");
    expect(SECURITY_TAXONOMY_VERSION).toMatch(/^\d{4}\.\d{2}\.\d{2}$/);
  });

  it("BENCHMARK_SCHEMA_VERSION follows semver", () => {
    expect(BENCHMARK_SCHEMA_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("BENCHMARK_DATASET_VERSION is a human-readable label, not a git SHA", () => {
    expect(BENCHMARK_DATASET_VERSION).not.toMatch(/^[0-9a-f]{7,40}$/);
  });

  it("REVIEWER_PROMPT_VERSION is derived from the taxonomy version constant, not independently guessed", () => {
    expect(REVIEWER_PROMPT_VERSION).toContain(SECURITY_TAXONOMY_VERSION);
  });
});
