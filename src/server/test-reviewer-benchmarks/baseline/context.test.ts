import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "@/server/review-engine/diff";
import { BENCHMARK_ROOT, loadFixture } from "../load-fixtures";
import { buildReviewContextFromFixture } from "./context";

const missingTests = loadFixture(path.join(BENCHMARK_ROOT, "missing-tests", "01-critical-behavior-added-without-tests"));
const missingErrorPath = loadFixture(path.join(BENCHMARK_ROOT, "missing-error-path", "01-only-happy-path-tested"));

describe("buildReviewContextFromFixture", () => {
  it("produces a ReviewContext whose changedFiles match the fixture's declared files", () => {
    const context = buildReviewContextFromFixture(missingTests);
    expect(context.changedFiles.map((f) => f.path)).toEqual(missingTests.manifest.files);
    expect(context.changedFiles.every((f) => f.status === "added")).toBe(true);
  });

  it("the synthetic diff's new-file line numbers exactly match the fixture source file's own line numbers", () => {
    const context = buildReviewContextFromFixture(missingTests);
    const parsed = parseUnifiedDiff(context.diffText);
    const file = parsed.find((f) => f.path === "verdict.ts");
    expect(file).toBeDefined();

    const line1 = file?.addedLines.find((l) => l.lineNumber === 1);
    expect(line1?.content).toContain("computeAutoMergeEligibility");
  });

  it("handles a multi-file fixture, combining both files into one diff", () => {
    const context = buildReviewContextFromFixture(missingErrorPath);
    const parsed = parseUnifiedDiff(context.diffText);
    expect(parsed.map((f) => f.path).sort()).toEqual(["score.test.ts", "score.ts"]);
  });

  it("pullRequestTitle/sourceBranch encode the fixture id for traceability", () => {
    const context = buildReviewContextFromFixture(missingTests);
    expect(context.pullRequestTitle).toContain(missingTests.manifest.fixture_id);
    expect(context.sourceBranch).toContain(missingTests.manifest.fixture_id);
    expect(context.targetBranch).toBe("main");
  });
});
