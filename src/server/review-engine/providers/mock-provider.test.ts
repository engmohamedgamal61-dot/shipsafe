import { describe, expect, it } from "vitest";
import { MockAIProvider } from "./mock-provider";
import type { AgentReviewOutput } from "@/domain/schemas";
import type { DiffReviewerKind, ReviewContext } from "../types";

const provider = new MockAIProvider();

function context(diffText: string): ReviewContext {
  return {
    pullRequestTitle: "test pr",
    sourceBranch: "feature/x",
    targetBranch: "main",
    changedFiles: [],
    diffText,
  };
}

async function review(reviewer: DiffReviewerKind, diffText: string): Promise<AgentReviewOutput> {
  const result = await provider.review({
    reviewer,
    instructions: "",
    context: context(diffText),
    attempt: 1,
  });
  return result.output;
}

describe("MockAIProvider — security", () => {
  it("flags a hardcoded secret as P0", async () => {
    const diff = [
      "diff --git a/src/lib/config.ts b/src/lib/config.ts",
      "--- a/src/lib/config.ts",
      "+++ b/src/lib/config.ts",
      "@@ -1,2 +1,3 @@",
      " export const config = {",
      '+  apiKey: "sk_live_abcdef123456",',
      " };",
    ].join("\n");

    const output = await review("security", diff);

    expect(output.findings).toHaveLength(1);
    expect(output.findings[0].severity).toBe("P0");
    expect(output.findings[0].category).toBe("hardcoded-secret");
    expect(output.findings[0].filePath).toBe("src/lib/config.ts");
  });

  it("flags string-interpolated SQL as a P0 injection risk", async () => {
    const diff = [
      "diff --git a/src/server/db.ts b/src/server/db.ts",
      "--- a/src/server/db.ts",
      "+++ b/src/server/db.ts",
      "@@ -1,1 +1,3 @@",
      "+export function findUser(id: string) {",
      "+  return db.query(`SELECT * FROM users WHERE id = ${id}`);",
      "+}",
    ].join("\n");

    const output = await review("security", diff);

    expect(output.findings.some((f) => f.category === "sql-injection")).toBe(true);
  });

  it("does not flag a secret read from process.env", async () => {
    const diff = [
      "diff --git a/src/lib/config.ts b/src/lib/config.ts",
      "--- a/src/lib/config.ts",
      "+++ b/src/lib/config.ts",
      "@@ -1,1 +1,2 @@",
      "+export const apiKey = process.env.API_KEY;",
    ].join("\n");

    const output = await review("security", diff);

    expect(output.findings).toHaveLength(0);
  });
});

describe("MockAIProvider — database", () => {
  it("flags DROP TABLE in a migration file as P0", async () => {
    const diff = [
      "diff --git a/supabase/migrations/0002_drop.sql b/supabase/migrations/0002_drop.sql",
      "--- a/supabase/migrations/0002_drop.sql",
      "+++ b/supabase/migrations/0002_drop.sql",
      "@@ -0,0 +1,1 @@",
      "+drop table legacy_events;",
    ].join("\n");

    const output = await review("database", diff);

    expect(output.findings).toHaveLength(1);
    expect(output.findings[0].severity).toBe("P0");
    expect(output.findings[0].category).toBe("destructive-migration");
  });

  it("ignores DROP TABLE outside a migration file", async () => {
    const diff = [
      "diff --git a/scripts/notes.sql b/scripts/notes.sql",
      "--- a/scripts/notes.sql",
      "+++ b/scripts/notes.sql",
      "@@ -0,0 +1,1 @@",
      "+-- drop table example when ready",
    ].join("\n");

    const output = await review("database", diff);

    expect(output.findings).toHaveLength(0);
  });
});

describe("MockAIProvider — code", () => {
  it("flags an empty catch block", async () => {
    const diff = [
      "diff --git a/src/server/handler.ts b/src/server/handler.ts",
      "--- a/src/server/handler.ts",
      "+++ b/src/server/handler.ts",
      "@@ -1,1 +1,3 @@",
      "+try {",
      "+  doWork();",
      "+} catch (e) {}",
    ].join("\n");

    const output = await review("code", diff);

    expect(output.findings.some((f) => f.category === "error-handling")).toBe(true);
  });
});

describe("MockAIProvider — test", () => {
  it("flags a substantial source change with no matching test update", async () => {
    const addedLines = Array.from({ length: 20 }, (_, i) => `+line ${i}`).join("\n");
    const diff = [
      "diff --git a/src/server/billing.ts b/src/server/billing.ts",
      "--- a/src/server/billing.ts",
      "+++ b/src/server/billing.ts",
      "@@ -0,0 +1,20 @@",
      addedLines,
    ].join("\n");

    const output = await review("test", diff);

    expect(output.findings).toHaveLength(1);
    expect(output.findings[0].category).toBe("missing-test");
  });

  it("does not flag when a matching test file is also in the diff", async () => {
    const addedLines = Array.from({ length: 20 }, (_, i) => `+line ${i}`).join("\n");
    const diff = [
      "diff --git a/src/server/billing.ts b/src/server/billing.ts",
      "--- a/src/server/billing.ts",
      "+++ b/src/server/billing.ts",
      "@@ -0,0 +1,20 @@",
      addedLines,
      "diff --git a/src/server/billing.test.ts b/src/server/billing.test.ts",
      "--- a/src/server/billing.test.ts",
      "+++ b/src/server/billing.test.ts",
      "@@ -0,0 +1,1 @@",
      "+test case",
    ].join("\n");

    const output = await review("test", diff);

    expect(output.findings).toHaveLength(0);
  });
});

describe("MockAIProvider — execution metadata", () => {
  it("returns provider execution metadata alongside the output", async () => {
    const result = await provider.review({
      reviewer: "code",
      instructions: "",
      context: context(""),
      attempt: 3,
    });

    expect(result.metadata.provider).toBe("mock");
    expect(result.metadata.attempt).toBe(3);
    expect(result.metadata.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
