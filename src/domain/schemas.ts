import { z } from "zod";

/**
 * Zod schemas mirroring `src/domain/types.ts`.
 *
 * These are the boundary contracts: anything coming from an AI provider,
 * an API route, or a form gets parsed through one of these before it is
 * trusted as a domain type.
 */

export const severitySchema = z.enum(["P0", "P1", "P2", "NIT"]);
export const verdictSchema = z.enum([
  "APPROVE",
  "APPROVE_WITH_MINOR_FIXES",
  "DO_NOT_APPROVE",
]);
export const reviewerKindSchema = z.enum([
  "code",
  "security",
  "architecture",
  "database",
  "test",
  "judge",
]);
export const runStatusSchema = z.enum([
  "pending",
  "running",
  "complete",
  "failed",
]);

export const changedFileStatusSchema = z.enum([
  "added",
  "modified",
  "removed",
  "renamed",
]);

export const changedFileSchema = z.object({
  path: z.string().min(1),
  status: changedFileStatusSchema,
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
});

/**
 * Shape an `AIProvider` must return for a single finding. Intentionally
 * narrower than the persisted `Finding` type — `id` and `reviewerRunId`
 * are assigned by the orchestrator, never by the model/heuristic.
 */
export const providerFindingSchema = z
  .object({
    severity: severitySchema,
    title: z.string().min(1).max(200),
    description: z.string().min(1),
    filePath: z.string().nullable(),
    lineStart: z.number().int().positive().nullable(),
    lineEnd: z.number().int().positive().nullable(),
    category: z.string().min(1),
    recommendation: z.string().min(1),
    /** Model/heuristic's own confidence in this finding, 0 (guess) to 1 (certain). */
    confidence: z.number().min(0).max(1),
  })
  .refine(
    (finding) =>
      finding.lineEnd === null ||
      finding.lineStart === null ||
      finding.lineEnd >= finding.lineStart,
    { message: "lineEnd must be >= lineStart", path: ["lineEnd"] },
  );

export const agentReviewOutputSchema = z.object({
  summary: z.string().min(1),
  findings: z.array(providerFindingSchema),
});

export type ProviderFinding = z.infer<typeof providerFindingSchema>;
export type AgentReviewOutput = z.infer<typeof agentReviewOutputSchema>;

export const judgeOutputSchema = z.object({
  verdict: verdictSchema,
  summary: z.string().min(1),
});

export type JudgeOutput = z.infer<typeof judgeOutputSchema>;
