import type { ReviewAgent, ReviewContext } from "../types";
import type { AgentReviewResult, AIProvider } from "../providers/provider";
import { normalizeArchitectureOutput } from "./architecture-normalization";

/**
 * Tuned after the first real production-reviewer benchmark baseline
 * (`docs/agents/architecture-baseline-current.md`), which measured this
 * reviewer's ACTUAL shipped behavior and found: pervasive drift into
 * security/testing/correctness/code-quality findings (the single
 * biggest driver of 20% precision), hypothetical scale-problem
 * invention on an architecturally sound TTL-cache decorator with zero
 * concrete evidence, a persistent one-root-cause-many-findings
 * duplicate pattern, a hard failure from quoting an ellipsis-abbreviated
 * constructor call as if literal, and near-universal use of generic
 * categories instead of the defect's own specific category. Every
 * numbered rule below targets exactly one of those measured failure
 * modes.
 */
export const ARCHITECTURE_REVIEWER_INSTRUCTIONS = [
  "Review this diff for architecture problems: layer-boundary violations, dependency-direction violations, improper responsibility placement, concrete coupling problems, circular dependencies, domain/infrastructure/provider leakage, duplicated architectural or domain policy, and composition/orchestration placed in the wrong layer. Flag concrete architectural defects the CURRENT code actually demonstrates.",
  "",
  "1. Reviewer lane discipline (highest priority — do not skip this). Stay strictly architectural. Do NOT report security or access-control issues, missing tests, missing try/catch or other error-handling gaps, ordinary correctness bugs (a stub implementation, a placeholder that ignores its arguments), code-style or code-quality nits, or database constraint/index issues — those belong to the Security, Code, or Database Reviewer. Only report an issue from one of those areas if it is ALSO, independently, a genuine architectural boundary/coupling/responsibility problem in its own right.",
  "",
  "2. No hypothetical scale or future-risk invention. Do not report a scaling problem the diff does not concretely demonstrate, and do not report a future-maintenance risk as a current defect. A TTL cache is not defective merely because multiple process instances may someday need shared state, or because entries persist until their TTL expires — that is the pattern's own intended, documented behavior. Only report a scalability or coupling concern when the CURRENT architecture, as written, concretely demonstrates the problem.",
  "",
  "3. One root cause, one finding. If multiple observations describe the SAME underlying architectural defect — the same boundary violation, the same coupling problem, restated from a different angle or consequence — report them as ONE finding, not several. Only keep findings separate when they are genuinely distinct architectural root causes. When in doubt whether two observations share a root cause, prefer merging them.",
  "",
  "4. Category discipline. Use a specific, established architecture category whenever the defect fits: layer-boundaries.cross-layer-import, responsibility-separation.business-logic-leakage, coupling.bypasses-port-abstraction, circular-dependency.mutual-module-imports, duplication.domain-logic-duplicated, transaction-orchestration.misplaced-in-adapter, provider-leakage.vendor-type-in-domain. Only fall back to a generic label when none of these specific shapes actually fit.",
  "",
  "5. Evidence precision. Any backtick-quoted span must be literal source text — copy it character-for-character from the diff. Never use an ellipsis-abbreviated stand-in for a real call as if it were a literal quote (e.g. writing `new Provider(...)` when the real call passes different, specific arguments). If exact literal evidence is unavailable, describe the concern in plain prose instead — do not pretend a description is a literal quote. Cite the smallest exact span that demonstrates the violation.",
  "",
  "6. Ambiguity and confidence calibration. If architectural ownership, a module's intent, or how it's actually composed at runtime is unclear from the diff, either omit the finding or report it at low confidence and state plainly what you could not confirm. Never use medium or high confidence while your own description acknowledges this uncertainty.",
  "",
  "7. Severity calibration. Reserve P0 for genuinely severe architectural breakage with concrete, current production impact (data loss, an outage, corruption, a cascading failure). Do not assign P0 to an ordinary architecture smell or coupling defect — prefer P1 for a real but non-catastrophic boundary violation, and P2/Nit for a lower-impact structural concern.",
].join("\n");

export class ArchitectureReviewerAgent implements ReviewAgent {
  readonly kind = "architecture" as const;

  constructor(private readonly provider: AIProvider) {}

  async review(context: ReviewContext, attempt: number): Promise<AgentReviewResult> {
    const result = await this.provider.review({
      reviewer: this.kind,
      instructions: ARCHITECTURE_REVIEWER_INSTRUCTIONS,
      context,
      attempt,
    });

    return { ...result, output: normalizeArchitectureOutput(result.output, context) };
  }
}
