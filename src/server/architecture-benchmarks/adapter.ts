import { z } from "zod";
import type { Finding as PersistedFinding } from "@/domain/types";
import { mapNumericConfidenceToBucket } from "./confidence-mapping";
import { reviewerResultSchema, type ProducedFinding, type ReviewerResult } from "./scorer";

/**
 * Pure adapter: persisted DB `Finding[]` (`src/domain/types.ts`) →
 * `scorer.ts`'s normalized `ReviewerResult`, for the Architecture
 * Reviewer. Identical in design and behavior to the other three
 * benchmarks' `adapter.ts` (same persisted shape, same field-by-field
 * mapping, same "never guess" refusal policy) — kept as an independent
 * copy per `tests/architecture-benchmarks/README.md`, since all four
 * benchmarks' scoring must stay logically separate even though the
 * underlying persisted `Finding` type is shared production
 * infrastructure.
 */
const persistedFindingInputSchema = z.object({
  severity: z.enum(["P0", "P1", "P2", "NIT"]),
  confidence: z.number(),
  filePath: z.string().nullable(),
  lineStart: z.number().int().nullable(),
  lineEnd: z.number().int().nullable(),
  category: z.string().min(1),
  description: z.string(),
});

export interface AdapterError {
  index: number;
  message: string;
}

export class AdapterValidationError extends Error {
  readonly errors: AdapterError[];
  constructor(errors: AdapterError[]) {
    super(`adaptPersistedFindings: ${errors.length} finding(s) failed validation — refusing to guess: ${errors.map((e) => `[${e.index}] ${e.message}`).join("; ")}`);
    this.name = "AdapterValidationError";
    this.errors = errors;
  }
}

export function adaptPersistedFindings(findings: readonly PersistedFinding[]): ReviewerResult {
  const errors: AdapterError[] = [];
  const adapted: ProducedFinding[] = [];

  findings.forEach((raw, index) => {
    const parsed = persistedFindingInputSchema.safeParse(raw);
    if (!parsed.success) {
      errors.push({ index, message: parsed.error.issues.map((issue) => issue.message).join("; ") });
      return;
    }
    const finding = parsed.data;

    if (finding.filePath === null && finding.lineStart !== null) {
      errors.push({ index, message: "lineStart is set while filePath is null — a line number with no file is malformed, not guessable" });
      return;
    }

    if (finding.confidence < 0 || finding.confidence > 1 || !Number.isFinite(finding.confidence)) {
      errors.push({ index, message: `confidence must be a finite number in [0, 1], got ${finding.confidence}` });
      return;
    }

    adapted.push({
      category: finding.category,
      severity: finding.severity === "NIT" ? "Nit" : finding.severity,
      confidence: mapNumericConfidenceToBucket(finding.confidence),
      file: finding.filePath,
      lineStart: finding.lineStart,
      lineEnd: finding.lineEnd,
      evidence: finding.description,
      // ruleId deliberately omitted — production emits none, never invented.
    });
  });

  if (errors.length > 0) throw new AdapterValidationError(errors);

  return reviewerResultSchema.parse({ needsMoreContext: false, findings: adapted });
}
