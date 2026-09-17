import type { ChangedFile } from "@/domain/types";
import type { AgentReviewResult, DiffReviewerKind } from "./providers/provider";

/** Everything an agent needs to review a PR. Framework-free. */
export interface ReviewContext {
  pullRequestTitle: string;
  sourceBranch: string;
  targetBranch: string;
  changedFiles: ChangedFile[];
  diffText: string;
  /**
   * True when `diffText`/`changedFiles` were cut short of the PR's actual
   * size by `src/server/github/pr-hardening.ts`. A real `AIProvider` must
   * tell the model explicitly when this is set — see
   * `src/server/review-engine/providers/prompt.ts` — rather than letting
   * it review a partial diff as if it were the whole PR.
   */
  diffTruncated: boolean;
  changedFilesTruncated: boolean;
}

export type { DiffReviewerKind };

/** Port every specialist agent implements. */
export interface ReviewAgent {
  readonly kind: DiffReviewerKind;
  review(context: ReviewContext, attempt: number): Promise<AgentReviewResult>;
}
