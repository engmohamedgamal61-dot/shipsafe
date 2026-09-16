/**
 * Framework-free domain types for ShipSafe.
 *
 * This module must never import from Next.js, Supabase, or React —
 * it is the shared vocabulary between the review engine, the persistence
 * layer, and the UI.
 */

export type Severity = "P0" | "P1" | "P2" | "NIT";

export const SEVERITIES: readonly Severity[] = ["P0", "P1", "P2", "NIT"];

export const SEVERITY_LABEL: Record<Severity, string> = {
  P0: "Critical",
  P1: "High priority",
  P2: "Improvement",
  NIT: "Nit",
};

export type Verdict =
  | "APPROVE"
  | "APPROVE_WITH_MINOR_FIXES"
  | "DO_NOT_APPROVE";

export const VERDICT_LABEL: Record<Verdict, string> = {
  APPROVE: "Approve",
  APPROVE_WITH_MINOR_FIXES: "Approve with minor fixes",
  DO_NOT_APPROVE: "Do not approve",
};

export type ReviewerKind =
  | "code"
  | "security"
  | "architecture"
  | "database"
  | "test"
  | "judge";

export const REVIEWER_LABEL: Record<ReviewerKind, string> = {
  code: "Code Reviewer",
  security: "Security Reviewer",
  architecture: "Architecture Reviewer",
  database: "Database Reviewer",
  test: "Test Reviewer",
  judge: "Release Judge",
};

export type RunStatus = "pending" | "running" | "complete" | "failed";

export type RepositoryProvider = "github" | "demo";

export type ChangedFileStatus = "added" | "modified" | "removed" | "renamed";

export interface ChangedFile {
  path: string;
  status: ChangedFileStatus;
  additions: number;
  deletions: number;
}

// ---------------------------------------------------------------------------
// Tenancy: every repository belongs to a workspace, not directly to a user.
// A user reaches a workspace through a WorkspaceMembership. Kept minimal for
// Phase 1 — owner/member only, no billing or invitations yet.
// ---------------------------------------------------------------------------

export type WorkspaceRole = "owner" | "member";

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  createdBy: string;
  createdAt: string;
}

export interface WorkspaceMembership {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  createdAt: string;
}

export interface Repository {
  id: string;
  workspaceId: string;
  provider: RepositoryProvider;
  /** Stable identity from the provider (e.g. GitHub repo id). Null for demo repositories. */
  externalId: string | null;
  name: string;
  fullName: string;
  defaultBranch: string;
  connectedAt: string;
}

export interface PullRequest {
  id: string;
  repositoryId: string;
  /** Stable identity from the provider (e.g. GitHub PR node id). Null for demo PRs. */
  externalId: string | null;
  number: number;
  title: string;
  sourceBranch: string;
  targetBranch: string;
  authorLogin: string;
  changedFiles: ChangedFile[];
  diffText: string;
  /** Current known head SHA of the PR — may move forward as new commits land. */
  headSha: string;
  baseSha: string;
  openedAt: string;
}

export interface Finding {
  id: string;
  reviewerRunId: string;
  severity: Severity;
  title: string;
  description: string;
  filePath: string | null;
  lineStart: number | null;
  lineEnd: number | null;
  category: string;
}

/** Execution metadata for one provider call — never raw chain-of-thought. */
export interface ProviderExecutionMetadata {
  provider: string;
  model: string;
  requestId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
  attempt: number;
}

export interface ReviewerRun {
  id: string;
  reviewId: string;
  reviewer: ReviewerKind;
  status: RunStatus;
  summary: string | null;
  /** Set when `status === 'failed'` — what the provider/agent reported. */
  errorMessage: string | null;
  providerMetadata: ProviderExecutionMetadata | null;
  startedAt: string | null;
  completedAt: string | null;
  findings: Finding[];
}

export interface Review {
  id: string;
  pullRequestId: string;
  status: RunStatus;
  verdict: Verdict | null;
  summary: string | null;
  /**
   * Set whenever `status === 'failed'` (fail-closed: a required reviewer or
   * the Release Judge itself didn't complete). Explains why no trustworthy
   * verdict could be produced.
   */
  failureReason: string | null;
  /**
   * The exact commit this review describes. Immutable once set — a new
   * head SHA always means a new Review row, never a mutated one. See
   * docs/ARCHITECTURE.md § Commit Binding.
   */
  reviewedHeadSha: string;
  reviewedBaseSha: string | null;
  /** Version of the review-engine rule set that produced this review. */
  ruleVersion: string;
  promptVersion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  reviewerRuns: ReviewerRun[];
}

/** A `Review` with its parent `PullRequest` and `Repository` inlined, for display. */
export interface ReviewWithContext extends Review {
  pullRequest: PullRequest;
  repository: Repository;
}

export interface SeverityCounts {
  P0: number;
  P1: number;
  P2: number;
  NIT: number;
}

export function emptySeverityCounts(): SeverityCounts {
  return { P0: 0, P1: 0, P2: 0, NIT: 0 };
}

export function countBySeverity(findings: readonly Finding[]): SeverityCounts {
  const counts = emptySeverityCounts();
  for (const finding of findings) {
    counts[finding.severity] += 1;
  }
  return counts;
}
