import type { ReviewAgent, ReviewContext } from "../types";
import type { AgentReviewResult, AIProvider } from "../providers/provider";
import { normalizeSecurityOutput } from "./security-normalization";

/**
 * Tuned after the first real production-reviewer benchmark baseline
 * (`docs/agents/security-baseline-current.md`), which measured this
 * reviewer's ACTUAL shipped behavior (not the aspirational
 * `docs/agents/security-reviewer-v2.md` spec) and found: a 100%
 * safe-code and ambiguous-case false-positive rate, a persistent
 * one-root-cause-many-findings duplicate pattern, and free-form,
 * inconsistent category labels including outright non-security ones.
 * Every numbered rule below targets exactly one of those measured
 * failure modes, not a hypothetical one — see that report's "Top 5
 * reviewer improvements" section for the evidence behind each.
 */
export const SECURITY_REVIEWER_INSTRUCTIONS = [
  "Review this diff for security vulnerabilities: hardcoded secrets, injection (SQL/command/code), XSS, SSRF, broken authentication/authorization, tenant-isolation gaps, webhook/signature verification, race conditions, and unsafe handling of untrusted input.",
  "",
  "1. Evidence sufficiency (highest priority — do not skip this). Only report a finding when the diff itself contains concrete, local evidence of an exploitable or security-relevant defect. The mere ABSENCE of a hardening measure, a best practice, or defense-in-depth is not itself a vulnerability. Do not assume, infer, or guess at surrounding infrastructure, authentication, authorization, deployment configuration, secrets management, or trust boundaries that are not directly evidenced in the diff/context you were given — if a control might exist elsewhere (a database policy, a middleware, a framework default) and you simply cannot see it here, that is not evidence it's missing.",
  "",
  "2. Ambiguity. When the available evidence genuinely supports more than one interpretation, do not report a confident, high-severity finding. Either omit the finding entirely, or report it at a lower severity and confidence than you would for a clear-cut case, and state plainly in the description what you could not confirm. When the specific thing you cannot confirm is whether the vulnerable code is actually REACHABLE — no call site, no route, no invocation, no grant/permission statement showing it is ever exercised with attacker-influenced input — use confidence 'low', not 'medium': unconfirmed reachability is a precondition for exploitability, not a minor caveat. Never resolve uncertainty by assuming the worst case.",
  "",
  "3. One root cause, one finding — but only when it truly is one cause. If multiple lines or call sites share the EXACT SAME underlying flaw (the same missing check, reached from several places), report ONE finding covering all of them instead of several near-duplicates. Do NOT merge two genuinely distinct defects into a single finding just because one enables or amplifies the other — for example, prompt injection and a separate missing-output-validation defect it exposes are two different root causes with two different remediations, and must remain two separate findings whenever each is independently evidenced, even though they're part of the same attack chain. When in doubt whether two observations are the same root cause, report them separately.",
  "",
  "4. Category discipline. Categorize each finding using a specific, established security vulnerability category — for example: access-control, authentication, injection, xss, ssrf, secrets-management, tenant-isolation, webhook-security, concurrency, api-security, business-logic. Never use a process or code-quality category such as 'code-review-process', 'code-quality', or 'informational' — if what you observed is not a concrete security defect, do not report it as a finding at all.",
  "",
  "5. Evidence anchoring. Cite the smallest CONTIGUOUS span of code that directly and materially demonstrates the vulnerability — this may be more than one line when the vulnerable operation itself spans multiple lines. Anchor to the line(s) where the actual dangerous operation happens (where untrusted data is concatenated, executed, written, or otherwise reaches the vulnerable sink) — never to an earlier declaration or function signature just because it's easier to quote, and never to a comment that only describes or acknowledges the issue. Quote the real text in full; never paraphrase with an ellipsis when you can quote it exactly.",
].join("\n");

export class SecurityReviewerAgent implements ReviewAgent {
  readonly kind = "security" as const;

  constructor(private readonly provider: AIProvider) {}

  async review(context: ReviewContext, attempt: number): Promise<AgentReviewResult> {
    const result = await this.provider.review({
      reviewer: this.kind,
      instructions: SECURITY_REVIEWER_INSTRUCTIONS,
      context,
      attempt,
    });

    return { ...result, output: normalizeSecurityOutput(result.output, context) };
  }
}
