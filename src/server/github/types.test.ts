import { describe, expect, it } from "vitest";
import {
  githubInstallationRepositoriesResponseSchema,
  githubInstallationWebhookBodySchema,
  githubPullRequestFileSchema,
  githubPullRequestWebhookBodySchema,
} from "./types";

const validAccount = { login: "acme-corp", type: "Organization" };
const validRepository = {
  id: 1,
  name: "payments-service",
  full_name: "acme/payments-service",
  default_branch: "main",
  owner: validAccount,
};

describe("githubPullRequestWebhookBodySchema", () => {
  const validBody = {
    action: "opened",
    installation: { id: 1, account: validAccount },
    repository: validRepository,
    pull_request: {
      id: 10,
      number: 42,
      title: "Add feature",
      user: { login: "octocat" },
      head: { sha: "abc", ref: "feat/x" },
      base: { sha: "def", ref: "main" },
    },
  };

  it("accepts a well-formed pull_request webhook body", () => {
    expect(githubPullRequestWebhookBodySchema.safeParse(validBody).success).toBe(true);
  });

  it("accepts a body with no installation (some deliveries omit it)", () => {
    const { installation: _installation, ...withoutInstallation } = validBody;
    void _installation;
    expect(githubPullRequestWebhookBodySchema.safeParse(withoutInstallation).success).toBe(true);
  });

  it("strips unknown fields rather than rejecting the payload for them", () => {
    const result = githubPullRequestWebhookBodySchema.safeParse({
      ...validBody,
      some_field_github_added_later: "whatever",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a body missing the pull_request field entirely", () => {
    const { pull_request: _pr, ...withoutPr } = validBody;
    void _pr;
    expect(githubPullRequestWebhookBodySchema.safeParse(withoutPr).success).toBe(false);
  });

  it("rejects a body where pull_request.number is a string instead of a number", () => {
    const malformed = { ...validBody, pull_request: { ...validBody.pull_request, number: "42" } };
    expect(githubPullRequestWebhookBodySchema.safeParse(malformed).success).toBe(false);
  });

  it("rejects a completely unrelated JSON shape", () => {
    expect(githubPullRequestWebhookBodySchema.safeParse({ hello: "world" }).success).toBe(false);
  });

  it("rejects a null payload", () => {
    expect(githubPullRequestWebhookBodySchema.safeParse(null).success).toBe(false);
  });
});

describe("githubInstallationWebhookBodySchema", () => {
  it("accepts a body with no repositories list (not every action includes one)", () => {
    const result = githubInstallationWebhookBodySchema.safeParse({
      action: "created",
      installation: { id: 1, account: validAccount },
    });
    expect(result.success).toBe(true);
  });

  it("rejects an installation.account with an invalid type value", () => {
    const result = githubInstallationWebhookBodySchema.safeParse({
      action: "created",
      installation: { id: 1, account: { login: "acme", type: "Robot" } },
    });
    expect(result.success).toBe(false);
  });
});

describe("githubPullRequestFileSchema", () => {
  it("accepts a file with a patch", () => {
    const result = githubPullRequestFileSchema.safeParse({
      filename: "src/a.ts",
      status: "modified",
      additions: 1,
      deletions: 1,
      patch: "@@ -1 +1 @@",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a file with no patch (binary, or too large to inline)", () => {
    const result = githubPullRequestFileSchema.safeParse({
      filename: "assets/logo.png",
      status: "added",
      additions: 0,
      deletions: 0,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a file missing additions/deletions", () => {
    const result = githubPullRequestFileSchema.safeParse({ filename: "src/a.ts", status: "modified" });
    expect(result.success).toBe(false);
  });
});

describe("githubInstallationRepositoriesResponseSchema", () => {
  it("accepts a well-formed repositories response", () => {
    const result = githubInstallationRepositoriesResponseSchema.safeParse({
      repositories: [validRepository],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a response that isn't shaped like { repositories: [...] }", () => {
    const result = githubInstallationRepositoriesResponseSchema.safeParse([validRepository]);
    expect(result.success).toBe(false);
  });
});
