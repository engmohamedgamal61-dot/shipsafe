import type { ReviewAgent, ReviewContext } from "../types";
import type { AgentReviewResult, AIProvider } from "../providers/provider";

export class ArchitectureReviewerAgent implements ReviewAgent {
  readonly kind = "architecture" as const;

  constructor(private readonly provider: AIProvider) {}

  review(context: ReviewContext, attempt: number): Promise<AgentReviewResult> {
    return this.provider.review({
      reviewer: this.kind,
      instructions:
        "Review this diff for architecture problems: tight coupling, layering violations, scalability concerns, and maintainability risks such as oversized files.",
      context,
      attempt,
    });
  }
}
