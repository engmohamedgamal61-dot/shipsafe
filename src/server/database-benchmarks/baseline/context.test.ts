import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "@/server/review-engine/diff";
import { BENCHMARK_ROOT, loadFixture } from "../load-fixtures";
import { buildReviewContextFromFixture } from "./context";

const missingFk = loadFixture(path.join(BENCHMARK_ROOT, "foreign-keys", "01-missing-foreign-key-reference"));
const cascade = loadFixture(path.join(BENCHMARK_ROOT, "cascade-delete", "01-unsafe-cascade-destroys-audit-trail"));

describe("buildReviewContextFromFixture", () => {
  it("produces a ReviewContext whose changedFiles match the fixture's declared files", () => {
    const context = buildReviewContextFromFixture(missingFk);
    expect(context.changedFiles.map((f) => f.path)).toEqual(missingFk.manifest.files);
    expect(context.changedFiles.every((f) => f.status === "added")).toBe(true);
  });

  it("the synthetic diff's new-file line numbers exactly match the fixture source file's own line numbers", () => {
    const context = buildReviewContextFromFixture(missingFk);
    const parsed = parseUnifiedDiff(context.diffText);
    const file = parsed.find((f) => f.path === "migration.sql");
    expect(file).toBeDefined();

    const line5 = file?.addedLines.find((l) => l.lineNumber === 5);
    expect(line5?.content).toContain("repository_id uuid not null,");
  });

  it("handles a multi-column table whose defect line is the exact expected line", () => {
    const context = buildReviewContextFromFixture(cascade);
    const parsed = parseUnifiedDiff(context.diffText);
    const file = parsed.find((f) => f.path === "migration.sql");
    const line6 = file?.addedLines.find((l) => l.lineNumber === 6);
    expect(line6?.content).toContain("actor_id uuid not null references public.profiles (id) on delete cascade,");
  });

  it("pullRequestTitle/sourceBranch encode the fixture id for traceability", () => {
    const context = buildReviewContextFromFixture(missingFk);
    expect(context.pullRequestTitle).toContain(missingFk.manifest.fixture_id);
    expect(context.sourceBranch).toContain(missingFk.manifest.fixture_id);
    expect(context.targetBranch).toBe("main");
  });
});
