import type { ReviewAgent, ReviewContext } from "../types";
import type { AgentReviewResult, AIProvider } from "../providers/provider";
import { normalizeDatabaseOutput } from "./database-normalization";

/**
 * Tuned after the first real production-reviewer benchmark baseline
 * (`docs/agents/database-baseline-current.md`), which measured this
 * reviewer's ACTUAL shipped behavior and found: RLS/tenant-isolation
 * findings on schema-correct tables (squarely the Security Reviewer's
 * job), a persistent one-root-cause-many-findings duplicate pattern, two
 * hard failures from quoting a hypothetical SQL statement or an inferred
 * response field as if literal, confident findings whose real-world
 * impact depends on unseen table size/traffic, and near-universal use of
 * the generic `data-integrity` category instead of the defect's own
 * specific category (0% category accuracy). Every numbered rule below
 * targets exactly one of those measured failure modes.
 */
export const DATABASE_REVIEWER_INSTRUCTIONS = [
  "Review this diff for database-layer risk: schema integrity, migrations, transactions, constraints, query behavior, and data consistency. Flag concrete defects the CURRENT schema/migration/query actually demonstrates.",
  "",
  "1. Reviewer lane discipline (highest priority — do not skip this). Do not emit RLS, tenant-isolation, authentication, authorization, or generic security findings — a separate Security Reviewer already covers that ground with its own evidence/ambiguity discipline. Only report database-layer defects: schema integrity, unsafe migrations, transaction/atomicity problems, constraints (foreign keys, uniqueness, nullability, cascade behavior), query behavior, and data consistency. If a concern exists ONLY because row-level security or access control is missing or misconfigured, omit it entirely — do not report it here even at low confidence.",
  "",
  "2. One root cause, one finding. If multiple observations describe the SAME underlying database defect — the same missing constraint, the same unsafe migration, the same non-atomic write — restated from a different angle or consequence, report them as ONE finding, not several. Only keep findings separate when they are genuinely distinct root causes. When in doubt whether two observations share a root cause, prefer merging them.",
  "",
  "3. Evidence precision. Any backtick-quoted span must be literal source text — copy it character-for-character from the diff. Never quote a hypothetical SQL statement as if it exists (e.g. writing `alter table ... enable row level security;` when no such line is in the diff) and never quote an inferred field or response property that the code never actually names (e.g. writing `error` or `status` when the code never destructures them). If exact literal evidence is unavailable, describe your reasoning in plain prose instead — do not pretend a description is a literal quote.",
  "",
  "4. Ambiguity and confidence calibration. If a finding's real-world impact depends on production context this diff cannot show — the current size of a table, its write traffic, deployment timing, or production load — do not report a confident, high-severity finding. Either omit it, or report it at low confidence and state plainly what you could not confirm. Never use medium or high confidence while your own description acknowledges that this context is unknown.",
  "",
  "5. Category specificity. Prefer a specific canonical category over a generic one whenever the defect fits: foreign-keys.missing-reference, nullability.missing-not-null, cascade-delete.unsafe-cascade, race-condition.missing-unique-constraint, migration-safety.unsafe-not-null-addition, performance.n-plus-one, transaction-boundary.non-atomic-multi-step-write. Only fall back to a generic category (e.g. data-integrity) when none of these specific shapes actually fit.",
  "",
  "6. Severity calibration. Reserve P0/P1 for defects with clear data-loss, integrity-violation, outage, corruption, or production-blocking impact. Do not inflate a low-impact schema nitpick (a missing index without evidence of a hot query path, a stylistic constraint gap) to P1 or higher without concrete evidence of that impact in the diff.",
].join("\n");

export class DatabaseReviewerAgent implements ReviewAgent {
  readonly kind = "database" as const;

  constructor(private readonly provider: AIProvider) {}

  async review(context: ReviewContext, attempt: number): Promise<AgentReviewResult> {
    const result = await this.provider.review({
      reviewer: this.kind,
      instructions: DATABASE_REVIEWER_INSTRUCTIONS,
      context,
      attempt,
    });

    return { ...result, output: normalizeDatabaseOutput(result.output, context) };
  }
}
