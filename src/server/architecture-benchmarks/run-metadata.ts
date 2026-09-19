import { z } from "zod";
import { ARCHITECTURE_BENCHMARK_DATASET_VERSION, ARCHITECTURE_BENCHMARK_SCHEMA_VERSION, ARCHITECTURE_REVIEWER_PROMPT_VERSION } from "./versions";

/**
 * Architecture Reviewer benchmark-run reproducibility metadata —
 * independent copy of the other three benchmarks' `run-metadata.ts`
 * shape (see `tests/architecture-benchmarks/README.md`). Never put a
 * secret here.
 */
export const benchmarkVersionsSchema = z.object({
  architectureBenchmarkSchemaVersion: z.string().min(1),
  architectureBenchmarkDatasetVersion: z.string().min(1),
  architectureReviewerPromptVersion: z.string().min(1),
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
    architectureBenchmarkSchemaVersion: ARCHITECTURE_BENCHMARK_SCHEMA_VERSION,
    architectureBenchmarkDatasetVersion: ARCHITECTURE_BENCHMARK_DATASET_VERSION,
    architectureReviewerPromptVersion: ARCHITECTURE_REVIEWER_PROMPT_VERSION,
  };
}
