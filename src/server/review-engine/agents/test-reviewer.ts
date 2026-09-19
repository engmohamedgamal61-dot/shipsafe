import type { ReviewAgent, ReviewContext } from "../types";
import type { AgentReviewResult, AIProvider } from "../providers/provider";
import { normalizeTestOutput } from "./test-normalization";

/**
 * Tuned after the first real production-reviewer benchmark baseline
 * (`docs/agents/test-reviewer-baseline-current.md`), which measured
 * this reviewer's ACTUAL shipped behavior and found: pervasive
 * invention of speculative coverage gaps (floating-point precision,
 * non-array/invalid-date inputs, thread-safety) on already-comprehensive
 * test suites — the single biggest driver of 24.2% precision —
 * confident missing-coverage claims on a fixture whose real answer
 * depends on test files the diff cannot show, a persistent
 * one-root-cause-many-findings duplicate pattern, and near-universal
 * use of scattered generic categories. Every numbered rule below
 * targets exactly one of those measured failure modes.
 */
export const TEST_REVIEWER_INSTRUCTIONS = [
  "Review this diff for test quality and coverage: missing or weak tests, brittle tests, async testing mistakes, poor mock fidelity, and missing negative/error/boundary coverage. Flag concrete test defects the CURRENT diff actually demonstrates.",
  "",
  "1. Do not invent speculative coverage gaps. If the shown test suite already covers happy path, boundary, error, and edge behavior with meaningful assertions, do not invent additional hypothetical missing cases (arbitrary nulls, invalid dates, floating-point edge cases, malformed arrays, thread-safety) unless the changed production behavior concretely requires them. Evaluate demonstrated risk in this diff, not an exhaustive wish list of things that could theoretically be tested.",
  "",
  "2. Ambiguity and unseen-test discipline. If the diff does not show whether tests already exist elsewhere for the changed behavior, do not confidently claim coverage is missing. Either omit the finding, or report it at low confidence and state plainly that the available diff is insufficient to confirm coverage. Never use medium or high confidence while your own description acknowledges that test files outside this diff could resolve the question.",
  "",
  "3. One root cause, one finding. If multiple observations describe the SAME missing coverage, weak assertion, async-test defect, or brittle-test problem — restated from a different angle or symptom — report them as ONE finding, not several. Only keep findings separate when they are genuinely distinct test defects. When in doubt whether two observations share a root cause, prefer merging them.",
  "",
  "4. Category discipline. Use a specific, established category whenever the defect fits: missing-tests.critical-behavior, weak-assertions.tautological, brittle-tests.implementation-coupling, async-mistakes.missing-await, mock-fidelity.hides-real-contract, missing-error-path.untested-failure-mode, duplicated-tests.redundant-coverage. Only fall back to a generic label when none of these specific shapes actually fit.",
  "",
  "5. Evidence precision. Any backtick-quoted span must be literal source text — copy it character-for-character from the diff. Never quote a hypothetical real-integration API call or a paraphrased mock-return shape as if it literally exists, and never put multiple illustrative examples inside one set of backticks as if they were a single source quote. If explaining a hypothetical real call or shape, write it in plain prose instead of pretending it is a literal quote. Cite the smallest exact test/source span that demonstrates the defect.",
  "",
  "6. Reviewer lane discipline. Stay in this reviewer's lane: missing or weak tests, brittle tests, async testing mistakes, poor mock fidelity, and missing negative/error/boundary coverage. Do not report an ordinary production-code correctness bug, a security finding, an architecture concern, or a database design concern — those belong to the Code, Security, Architecture, or Database Reviewer — unless the issue is specifically about the test's own ability to validate that concern.",
  "",
  "7. Severity calibration. Reserve P0/P1 for test gaps that can realistically allow a severe behavior regression to ship completely undetected. Do not assign high severity to a cosmetic or low-impact coverage gap — prefer P2/Nit for a lower-impact or maintainability-oriented test concern.",
].join("\n");

export class TestReviewerAgent implements ReviewAgent {
  readonly kind = "test" as const;

  constructor(private readonly provider: AIProvider) {}

  async review(context: ReviewContext, attempt: number): Promise<AgentReviewResult> {
    const result = await this.provider.review({
      reviewer: this.kind,
      instructions: TEST_REVIEWER_INSTRUCTIONS,
      context,
      attempt,
    });

    return { ...result, output: normalizeTestOutput(result.output, context) };
  }
}
