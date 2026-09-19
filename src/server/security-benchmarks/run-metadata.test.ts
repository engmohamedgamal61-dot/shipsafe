import { describe, expect, it } from "vitest";
import { benchmarkRunMetadataSchema, currentBenchmarkVersions } from "./run-metadata";
import { BENCHMARK_DATASET_VERSION, BENCHMARK_SCHEMA_VERSION, REVIEWER_PROMPT_VERSION, SECURITY_TAXONOMY_VERSION } from "./versions";

function validMetadata(overrides: Record<string, unknown> = {}): unknown {
  return {
    provider: "anthropic",
    model: "claude-sonnet-5",
    concurrency: 4,
    timeoutMs: 60_000,
    versions: currentBenchmarkVersions(),
    runTimestamp: "2026-09-19T00:00:00.000Z",
    ...overrides,
  };
}

describe("currentBenchmarkVersions", () => {
  it("stamps every constant from versions.ts", () => {
    expect(currentBenchmarkVersions()).toEqual({
      securityTaxonomyVersion: SECURITY_TAXONOMY_VERSION,
      benchmarkSchemaVersion: BENCHMARK_SCHEMA_VERSION,
      benchmarkDatasetVersion: BENCHMARK_DATASET_VERSION,
      reviewerPromptVersion: REVIEWER_PROMPT_VERSION,
    });
  });
});

describe("benchmarkRunMetadataSchema", () => {
  it("accepts a well-formed run metadata object", () => {
    expect(benchmarkRunMetadataSchema.safeParse(validMetadata()).success).toBe(true);
  });

  it("accepts optional temperature/thinkingMode/maxTokens when supplied", () => {
    const parsed = benchmarkRunMetadataSchema.safeParse(
      validMetadata({ temperature: 0.2, thinkingMode: "extended", maxTokens: 8000 }),
    );
    expect(parsed.success).toBe(true);
  });

  it("does not require temperature/thinkingMode/maxTokens", () => {
    const parsed = benchmarkRunMetadataSchema.safeParse(validMetadata());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.temperature).toBeUndefined();
      expect(parsed.data.thinkingMode).toBeUndefined();
      expect(parsed.data.maxTokens).toBeUndefined();
    }
  });

  it("rejects a missing provider/model/versions", () => {
    const { provider: _provider, ...withoutProvider } = validMetadata() as Record<string, unknown>;
    expect(benchmarkRunMetadataSchema.safeParse(withoutProvider).success).toBe(false);

    const { versions: _versions, ...withoutVersions } = validMetadata() as Record<string, unknown>;
    expect(benchmarkRunMetadataSchema.safeParse(withoutVersions).success).toBe(false);
  });

  it("rejects a non-ISO-8601 runTimestamp", () => {
    expect(benchmarkRunMetadataSchema.safeParse(validMetadata({ runTimestamp: "yesterday" })).success).toBe(false);
  });

  it("rejects a non-positive concurrency or timeoutMs", () => {
    expect(benchmarkRunMetadataSchema.safeParse(validMetadata({ concurrency: 0 })).success).toBe(false);
    expect(benchmarkRunMetadataSchema.safeParse(validMetadata({ timeoutMs: -1 })).success).toBe(false);
  });

  it("has no field for an API key or other credential", () => {
    const shape = Object.keys(benchmarkRunMetadataSchema.shape);
    // "maxTokens" is a legitimate, non-secret field (a token-count limit,
    // not an auth token) — excluded from the substring check below rather
    // than loosening the check itself.
    for (const key of shape.filter((k) => k !== "maxTokens")) {
      expect(key.toLowerCase()).not.toMatch(/apikey|secret|password|credential|authtoken|bearer/);
    }
  });
});
