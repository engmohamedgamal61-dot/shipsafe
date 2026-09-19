import { z } from "zod";
import { CODE_BENCHMARK_DATASET_VERSION, CODE_BENCHMARK_SCHEMA_VERSION, CODE_REVIEWER_PROMPT_VERSION } from "./versions";

/**
 * Code Reviewer benchmark-run reproducibility metadata — independent
 * copy of `security-benchmarks/run-metadata.ts`'s shape (see
 * `tests/code-benchmarks/README.md`). Never put a secret here.
 */
export const benchmarkVersionsSchema = z.object({
  codeBenchmarkSchemaVersion: z.string().min(1),
  codeBenchmarkDatasetVersion: z.string().min(1),
  codeReviewerPromptVersion: z.string().min(1),
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
    codeBenchmarkSchemaVersion: CODE_BENCHMARK_SCHEMA_VERSION,
    codeBenchmarkDatasetVersion: CODE_BENCHMARK_DATASET_VERSION,
    codeReviewerPromptVersion: CODE_REVIEWER_PROMPT_VERSION,
  };
}
