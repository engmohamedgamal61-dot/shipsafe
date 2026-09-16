import type { ReviewAgent, ReviewContext } from "../types";
import type { AgentReviewResult, AIProvider } from "../providers/provider";

export class DatabaseReviewerAgent implements ReviewAgent {
  readonly kind = "database" as const;

  constructor(private readonly provider: AIProvider) {}

  review(context: ReviewContext, attempt: number): Promise<AgentReviewResult> {
    return this.provider.review({
      reviewer: this.kind,
      instructions:
        "Review this diff for database and migration risk: destructive schema changes, locking migrations, missing backfills, and data-integrity issues.",
      context,
      attempt,
    });
  }
}
