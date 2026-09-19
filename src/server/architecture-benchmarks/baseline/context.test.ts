import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "@/server/review-engine/diff";
import { BENCHMARK_ROOT, loadFixture } from "../load-fixtures";
import { buildReviewContextFromFixture } from "./context";

const layerBoundaries = loadFixture(path.join(BENCHMARK_ROOT, "layer-boundaries", "01-repository-imports-ui-component"));
const circularDependency = loadFixture(path.join(BENCHMARK_ROOT, "circular-dependency", "01-mutual-imports-between-services"));

describe("buildReviewContextFromFixture", () => {
  it("produces a ReviewContext whose changedFiles match the fixture's declared files", () => {
    const context = buildReviewContextFromFixture(layerBoundaries);
    expect(context.changedFiles.map((f) => f.path)).toEqual(layerBoundaries.manifest.files);
    expect(context.changedFiles.every((f) => f.status === "added")).toBe(true);
  });

  it("the synthetic diff's new-file line numbers exactly match the fixture source file's own line numbers", () => {
    const context = buildReviewContextFromFixture(layerBoundaries);
    const parsed = parseUnifiedDiff(context.diffText);
    const file = parsed.find((f) => f.path === "supabase-adapter.ts");
    expect(file).toBeDefined();

    const line2 = file?.addedLines.find((l) => l.lineNumber === 2);
    expect(line2?.content).toContain("RepositoryCard");
  });

  it("handles a multi-file fixture, combining both files into one diff", () => {
    const context = buildReviewContextFromFixture(circularDependency);
    const parsed = parseUnifiedDiff(context.diffText);
    expect(parsed.map((f) => f.path).sort()).toEqual(["ingest.ts", "seed.ts"]);
  });

  it("pullRequestTitle/sourceBranch encode the fixture id for traceability", () => {
    const context = buildReviewContextFromFixture(layerBoundaries);
    expect(context.pullRequestTitle).toContain(layerBoundaries.manifest.fixture_id);
    expect(context.sourceBranch).toContain(layerBoundaries.manifest.fixture_id);
    expect(context.targetBranch).toBe("main");
  });
});
