import type { ReviewAgent, ReviewContext } from "../types";
import type { AgentReviewResult, AIProvider } from "../providers/provider";

export class TestReviewerAgent implements ReviewAgent {
  readonly kind = "test" as const;

  constructor(private readonly provider: AIProvider) {}

  review(context: ReviewContext, attempt: number): Promise<AgentReviewResult> {
    return this.provider.review({
      reviewer: this.kind,
      instructions:
        "Review this diff for missing or weak tests: substantial logic changes without matching test updates, and coverage gaps for concurrency/race conditions.",
      context,
      attempt,
    });
  }
}
