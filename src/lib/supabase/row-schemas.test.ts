import { describe, expect, it } from "vitest";
import { findingRowSchema, repositoryRowSchema, reviewRowSchema } from "./row-schemas";

const validRepositoryRow = {
  id: "repo-1",
  workspace_id: "ws-1",
  provider: "github",
  external_repository_id: "123",
  github_installation_id: "install-1",
  name: "payments-service",
  full_name: "acme/payments-service",
  default_branch: "main",
  connected_at: "2026-01-01T00:00:00.000Z",
};

describe("repositoryRowSchema", () => {
  it("accepts a well-formed row", () => {
    expect(repositoryRowSchema.safeParse(validRepositoryRow).success).toBe(true);
  });

  it("accepts a demo row with null external/installation ids", () => {
    const result = repositoryRowSchema.safeParse({
      ...validRepositoryRow,
      provider: "demo",
      external_repository_id: null,
      github_installation_id: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown provider value instead of silently trusting it", () => {
    const result = repositoryRowSchema.safeParse({ ...validRepositoryRow, provider: "gitlab" });
    expect(result.success).toBe(false);
  });

  it("rejects a row missing a required field", () => {
    const { name: _name, ...withoutName } = validRepositoryRow;
    void _name;
    expect(repositoryRowSchema.safeParse(withoutName).success).toBe(false);
  });

  it("rejects a row with a field of the wrong type", () => {
    const result = repositoryRowSchema.safeParse({ ...validRepositoryRow, id: 123 });
    expect(result.success).toBe(false);
  });
});

describe("findingRowSchema", () => {
  const validFinding = {
    id: "finding-1",
    reviewer_run_id: "run-1",
    severity: "P0",
    title: "Hardcoded secret",
    description: "a secret is hardcoded",
    file_path: "src/a.ts",
    line_start: 10,
    line_end: 12,
    category: "hardcoded-secret",
    recommendation: "rotate the credential",
    confidence: 0.9,
  };

  it("accepts a well-formed finding", () => {
    expect(findingRowSchema.safeParse(validFinding).success).toBe(true);
  });

  it("rejects a severity outside the known set", () => {
    const result = findingRowSchema.safeParse({ ...validFinding, severity: "P5" });
    expect(result.success).toBe(false);
  });

  it("accepts null file_path/line_start/line_end (a finding with no specific location)", () => {
    const result = findingRowSchema.safeParse({
      ...validFinding,
      file_path: null,
      line_start: null,
      line_end: null,
    });
    expect(result.success).toBe(true);
  });
});

describe("reviewRowSchema", () => {
  const validReview = {
    id: "review-1",
    pull_request_id: "pr-1",
    status: "complete",
    verdict: "APPROVE",
    summary: "Looks good",
    failure_reason: null,
    reviewed_head_sha: "abc123",
    reviewed_base_sha: "def456",
    rule_version: "v1",
    prompt_version: null,
    started_at: "2026-01-01T00:00:00.000Z",
    completed_at: "2026-01-01T00:01:00.000Z",
    diff_truncated: false,
    changed_files_truncated: false,
    pull_requests: {
      id: "pr-1",
      repository_id: "repo-1",
      external_pull_request_id: "999",
      number: 42,
      title: "Add feature",
      source_branch: "feat/x",
      target_branch: "main",
      author_login: "octocat",
      changed_files: [{ path: "src/a.ts", status: "modified", additions: 1, deletions: 1 }],
      diff_text: "diff --git a/x b/x",
      head_sha: "abc123",
      base_sha: "def456",
      opened_at: "2026-01-01T00:00:00.000Z",
      repositories: validRepositoryRow,
    },
    reviewer_runs: [],
  };

  it("accepts a well-formed nested review row", () => {
    const result = reviewRowSchema.safeParse(validReview);
    expect(result.success).toBe(true);
  });

  it("rejects an invalid verdict value nested deep in the row", () => {
    const result = reviewRowSchema.safeParse({ ...validReview, verdict: "MAYBE" });
    expect(result.success).toBe(false);
  });

  it("rejects when the nested repository row is malformed", () => {
    const malformed = {
      ...validReview,
      pull_requests: {
        ...validReview.pull_requests,
        repositories: { ...validRepositoryRow, provider: "not-a-real-provider" },
      },
    };
    expect(reviewRowSchema.safeParse(malformed).success).toBe(false);
  });

  it("accepts a changed_files entry with an explicit binary flag", () => {
    const withBinary = {
      ...validReview,
      pull_requests: {
        ...validReview.pull_requests,
        changed_files: [
          { path: "assets/logo.png", status: "added", additions: 0, deletions: 0, binary: true },
        ],
      },
    };
    expect(reviewRowSchema.safeParse(withBinary).success).toBe(true);
  });

  it("rejects a changed_files entry with an unknown status", () => {
    const malformed = {
      ...validReview,
      pull_requests: {
        ...validReview.pull_requests,
        changed_files: [{ path: "src/a.ts", status: "unchanged", additions: 0, deletions: 0 }],
      },
    };
    expect(reviewRowSchema.safeParse(malformed).success).toBe(false);
  });
});
