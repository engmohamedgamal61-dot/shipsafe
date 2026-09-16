import type { ChangedFile } from "@/domain/types";
import type { AgentReviewResult, DiffReviewerKind } from "./providers/provider";

/** Everything an agent needs to review a PR. Framework-free. */
export interface ReviewContext {
  pullRequestTitle: string;
  sourceBranch: string;
  targetBranch: string;
  changedFiles: ChangedFile[];
  diffText: string;
}

export type { DiffReviewerKind };

/** Port every specialist agent implements. */
export interface ReviewAgent {
  readonly kind: DiffReviewerKind;
  review(context: ReviewContext, attempt: number): Promise<AgentReviewResult>;
}
