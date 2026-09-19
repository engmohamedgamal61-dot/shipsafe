import { z } from "zod";
import { TEST_REVIEWER_BENCHMARK_DATASET_VERSION, TEST_REVIEWER_BENCHMARK_SCHEMA_VERSION, TEST_REVIEWER_PROMPT_VERSION } from "./versions";

/**
 * Test Reviewer benchmark-run reproducibility metadata — independent
 * copy of the other four benchmarks' `run-metadata.ts` shape (see
 * `tests/test-reviewer-benchmarks/README.md`). Never put a secret here.
 */
export const benchmarkVersionsSchema = z.object({
  testReviewerBenchmarkSchemaVersion: z.string().min(1),
  testReviewerBenchmarkDatasetVersion: z.string().min(1),
  testReviewerPromptVersion: z.string().min(1),
});
export type BenchmarkVersions = z.infer<typeof benchmarkVersionsSchema>;

export const benchmarkRunMetadataSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  temperature: z.number().min(0).max(2).optional(),
  thinkingMode: z.string().min(1).optional(),
  maxTokens: z.number().int().positive().optional(),
  concurrency: z.number().int().positive(),
  timeoutMs: z.number().int().positive(),
  versions: benchmarkVersionsSchema,
  runTimestamp: z.string().datetime(),
});
export type BenchmarkRunMetadata = z.infer<typeof benchmarkRunMetadataSchema>;

export function currentBenchmarkVersions(): BenchmarkVersions {
  return {
    testReviewerBenchmarkSchemaVersion: TEST_REVIEWER_BENCHMARK_SCHEMA_VERSION,
    testReviewerBenchmarkDatasetVersion: TEST_REVIEWER_BENCHMARK_DATASET_VERSION,
    testReviewerPromptVersion: TEST_REVIEWER_PROMPT_VERSION,
  };
}
