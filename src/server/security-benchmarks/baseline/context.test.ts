import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "@/server/review-engine/diff";
import { BENCHMARK_ROOT, loadFixture } from "../load-fixtures";
import { buildReviewContextFromFixture } from "./context";

const accessControlVulnerable = loadFixture(
  path.join(BENCHMARK_ROOT, "access-control", "01-idor-service-role-no-owner-check"),
);
const llmMultiField = loadFixture(path.join(BENCHMARK_ROOT, "llm-ai", "01-prompt-injection-unsafe-tool-use"));

describe("buildReviewContextFromFixture", () => {
  it("produces a ReviewContext whose changedFiles match the fixture's declared files", () => {
    const context = buildReviewContextFromFixture(accessControlVulnerable);
    expect(context.changedFiles.map((f) => f.path)).toEqual(accessControlVulnerable.manifest.files);
    expect(context.changedFiles.every((f) => f.status === "added")).toBe(true);
    expect(context.diffTruncated).toBe(false);
    expect(context.changedFilesTruncated).toBe(false);
  });

  it("the synthetic diff's new-file line numbers exactly match the fixture source file's own line numbers (critical for matching expected.json's line_ranges)", () => {
    const context = buildReviewContextFromFixture(accessControlVulnerable);
    const parsed = parseUnifiedDiff(context.diffText);
    const routeFile = parsed.find((f) => f.path === "route.ts");
    expect(routeFile).toBeDefined();

    const sourceLines = accessControlVulnerable.sourceFiles["route.ts"]?.split(/\r?\n/) ?? [];
    const nonEmptyTrailing = sourceLines[sourceLines.length - 1] === "" ? sourceLines.slice(0, -1) : sourceLines;

    expect(routeFile?.addedLines).toHaveLength(nonEmptyTrailing.length);
    // Line 8 in the fixture source ("const supabase = createServiceSupabaseClient();")
    // must land on line 8 in the parsed diff too.
    const line8 = routeFile?.addedLines.find((l) => l.lineNumber === 8);
    expect(line8?.content).toBe(nonEmptyTrailing[7]);
    expect(line8?.content).toContain("createServiceSupabaseClient");
  });

  it("handles a multi-file fixture by concatenating each file's own synthetic diff, each independently addressable", () => {
    const context = buildReviewContextFromFixture(llmMultiField);
    expect(context.changedFiles).toHaveLength(llmMultiField.manifest.files.length);
    const parsed = parseUnifiedDiff(context.diffText);
    expect(parsed.map((f) => f.path)).toEqual(llmMultiField.manifest.files);
  });

  it("pullRequestTitle/sourceBranch encode the fixture id for traceability", () => {
    const context = buildReviewContextFromFixture(accessControlVulnerable);
    expect(context.pullRequestTitle).toContain(accessControlVulnerable.manifest.fixture_id);
    expect(context.sourceBranch).toContain(accessControlVulnerable.manifest.fixture_id);
    expect(context.targetBranch).toBe("main");
  });
});
