import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "@/server/review-engine/diff";
import { BENCHMARK_ROOT, loadFixture } from "../load-fixtures";
import { buildReviewContextFromFixture } from "./context";

const offByOne = loadFixture(path.join(BENCHMARK_ROOT, "correctness", "01-off-by-one-pagination"));
const swallowed = loadFixture(path.join(BENCHMARK_ROOT, "error-handling", "01-swallowed-exception-async"));

describe("buildReviewContextFromFixture", () => {
  it("produces a ReviewContext whose changedFiles match the fixture's declared files", () => {
    const context = buildReviewContextFromFixture(offByOne);
    expect(context.changedFiles.map((f) => f.path)).toEqual(offByOne.manifest.files);
    expect(context.changedFiles.every((f) => f.status === "added")).toBe(true);
  });

  it("the synthetic diff's new-file line numbers exactly match the fixture source file's own line numbers", () => {
    const context = buildReviewContextFromFixture(offByOne);
    const parsed = parseUnifiedDiff(context.diffText);
    const file = parsed.find((f) => f.path === "paginate.ts");
    expect(file).toBeDefined();

    const line7 = file?.addedLines.find((l) => l.lineNumber === 7);
    expect(line7?.content).toContain("items.slice(start, end + 1)");
  });

  it("handles a multi-line function whose catch block is on the exact expected line", () => {
    const context = buildReviewContextFromFixture(swallowed);
    const parsed = parseUnifiedDiff(context.diffText);
    const file = parsed.find((f) => f.path === "reindex.ts");
    const line11 = file?.addedLines.find((l) => l.lineNumber === 11);
    expect(line11?.content).toContain("catch (err)");
  });

  it("pullRequestTitle/sourceBranch encode the fixture id for traceability", () => {
    const context = buildReviewContextFromFixture(offByOne);
    expect(context.pullRequestTitle).toContain(offByOne.manifest.fixture_id);
    expect(context.sourceBranch).toContain(offByOne.manifest.fixture_id);
    expect(context.targetBranch).toBe("main");
  });
});
