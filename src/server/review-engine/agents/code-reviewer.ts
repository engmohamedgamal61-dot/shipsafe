import type { ReviewAgent, ReviewContext } from "../types";
import type { AgentReviewResult, AIProvider } from "../providers/provider";

export class CodeReviewerAgent implements ReviewAgent {
  readonly kind = "code" as const;

  constructor(private readonly provider: AIProvider) {}

  review(context: ReviewContext, attempt: number): Promise<AgentReviewResult> {
    return this.provider.review({
      reviewer: this.kind,
      instructions:
        "Review this diff for correctness bugs, logic errors, edge cases, and swallowed errors. Flag anything that will misbehave at runtime.",
      context,
      attempt,
    });
  }
}
