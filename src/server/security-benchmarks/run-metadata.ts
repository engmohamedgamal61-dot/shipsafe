import { z } from "zod";
import { BENCHMARK_DATASET_VERSION, BENCHMARK_SCHEMA_VERSION, REVIEWER_PROMPT_VERSION, SECURITY_TAXONOMY_VERSION } from "./versions";

/**
 * Task 4 — provider/model reproducibility metadata a benchmark harness
 * must attach to every report (plan §8's "Required benchmark report
 * header"). Structurally permissive (plain non-empty strings, not tied
 * to a specific provider's SDK types) since this module must not import
 * anything from a specific provider integration — it only records
 * what a harness reports about itself.
 *
 * **Never put a secret here.** No API key, bearer token, or raw
 * request/response body belongs in this object — `provider`/`model`
 * name WHICH backend ran, never how to authenticate to it. A caller
 * that has a credential in scope while building this object must not
 * reach for it.
 */
export const benchmarkVersionsSchema = z.object({
  securityTaxonomyVersion: z.string().min(1),
  benchmarkSchemaVersion: z.string().min(1),
  benchmarkDatasetVersion: z.string().min(1),
  reviewerPromptVersion: z.string().min(1),
});
export type BenchmarkVersions = z.infer<typeof benchmarkVersionsSchema>;

export const benchmarkRunMetadataSchema = z.object({
  /** e.g. `"anthropic"` — which backend actually generated the benchmarked output. */
  provider: z.string().min(1),
  /** e.g. `"claude-sonnet-5"` — the exact model id, not a family name alone. */
  model: z.string().min(1),
  /** Omitted when the provider call didn't set one / isn't applicable — never defaulted to a guessed value. */
  temperature: z.number().min(0).max(2).optional(),
  /** Free-form (a provider's own thinking-mode label, e.g. `"extended"`) — omitted when not applicable/known. */
  thinkingMode: z.string().min(1).optional(),
  maxTokens: z.number().int().positive().optional(),
  /** How many fixtures this run evaluated in parallel. */
  concurrency: z.number().int().positive(),
  /** Per-fixture provider-call timeout, in milliseconds. */
  timeoutMs: z.number().int().positive(),
  versions: benchmarkVersionsSchema,
  /** ISO 8601 — when the run itself happened. This IS a timestamp, unlike the version constants in `versions.ts`: it records "when this specific run occurred," not "what version is this benchmark" (see that module's doc comment for why those two are kept separate). */
  runTimestamp: z.string().datetime(),
});
export type BenchmarkRunMetadata = z.infer<typeof benchmarkRunMetadataSchema>;

/** The `versions` sub-object every current-run report should stamp — reads `versions.ts`'s hand-bumped constants rather than re-deriving them. */
export function currentBenchmarkVersions(): BenchmarkVersions {
  return {
    securityTaxonomyVersion: SECURITY_TAXONOMY_VERSION,
    benchmarkSchemaVersion: BENCHMARK_SCHEMA_VERSION,
    benchmarkDatasetVersion: BENCHMARK_DATASET_VERSION,
    reviewerPromptVersion: REVIEWER_PROMPT_VERSION,
  };
}
