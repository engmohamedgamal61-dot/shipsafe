import type { ReviewAgent, ReviewContext } from "../types";
import type { AgentReviewResult, AIProvider } from "../providers/provider";

export class SecurityReviewerAgent implements ReviewAgent {
  readonly kind = "security" as const;

  constructor(private readonly provider: AIProvider) {}

  review(context: ReviewContext, attempt: number): Promise<AgentReviewResult> {
    return this.provider.review({
      reviewer: this.kind,
      instructions:
        "Review this diff for security vulnerabilities: hardcoded secrets, injection (SQL/command/code), XSS, broken auth/permissions, and tenant-isolation gaps.",
      context,
      attempt,
    });
  }
}
