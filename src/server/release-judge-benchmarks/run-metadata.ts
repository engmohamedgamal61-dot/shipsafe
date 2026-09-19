import { z } from "zod";
import {
  RELEASE_JUDGE_BENCHMARK_DATASET_VERSION,
  RELEASE_JUDGE_BENCHMARK_SCHEMA_VERSION,
  RELEASE_JUDGE_PROMPT_VERSION,
} from "./versions";

/**
 * Release Judge benchmark-run reproducibility metadata — independent
 * copy of the five specialist reviewers' `run-metadata.ts` shape (see
 * `tests/release-judge-benchmarks/README.md`). Never put a secret here.
 */
export const benchmarkVersionsSchema = z.object({
  releaseJudgeBenchmarkSchemaVersion: z.string().min(1),
  releaseJudgeBenchmarkDatasetVersion: z.string().min(1),
  releaseJudgePromptVersion: z.string().min(1),
});
export type BenchmarkVersions = z.infer<typeof benchmarkVersionsSchema>;

export const benchmarkRunMetadataSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  maxTokens: z.number().int().positive().optional(),
  concurrency: z.number().int().positive(),
  timeoutMs: z.number().int().positive(),
  versions: benchmarkVersionsSchema,
  runTimestamp: z.string().datetime(),
});
export type BenchmarkRunMetadata = z.infer<typeof benchmarkRunMetadataSchema>;

export function currentBenchmarkVersions(): BenchmarkVersions {
  return {
    releaseJudgeBenchmarkSchemaVersion: RELEASE_JUDGE_BENCHMARK_SCHEMA_VERSION,
    releaseJudgeBenchmarkDatasetVersion: RELEASE_JUDGE_BENCHMARK_DATASET_VERSION,
    releaseJudgePromptVersion: RELEASE_JUDGE_PROMPT_VERSION,
  };
}
