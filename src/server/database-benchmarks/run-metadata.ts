import { z } from "zod";
import { DATABASE_BENCHMARK_DATASET_VERSION, DATABASE_BENCHMARK_SCHEMA_VERSION, DATABASE_REVIEWER_PROMPT_VERSION } from "./versions";

/**
 * Database Reviewer benchmark-run reproducibility metadata — independent
 * copy of `code-benchmarks/run-metadata.ts`'s shape (see
 * `tests/database-benchmarks/README.md`). Never put a secret here.
 */
export const benchmarkVersionsSchema = z.object({
  databaseBenchmarkSchemaVersion: z.string().min(1),
  databaseBenchmarkDatasetVersion: z.string().min(1),
  databaseReviewerPromptVersion: z.string().min(1),
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
    databaseBenchmarkSchemaVersion: DATABASE_BENCHMARK_SCHEMA_VERSION,
    databaseBenchmarkDatasetVersion: DATABASE_BENCHMARK_DATASET_VERSION,
    databaseReviewerPromptVersion: DATABASE_REVIEWER_PROMPT_VERSION,
  };
}
