import { describe, expect, it } from "vitest";
import { hardenPullRequestInput } from "./pr-hardening";
import type { GithubPullRequestFile } from "./types";

function file(overrides: Partial<GithubPullRequestFile> = {}): GithubPullRequestFile {
  return {
    filename: "src/a.ts",
    status: "modified",
    additions: 1,
    deletions: 1,
    patch: "@@ -1 +1 @@",
    ...overrides,
  };
}

describe("hardenPullRequestInput", () => {
  it("passes small diffs and file lists through unchanged", () => {
    const result = hardenPullRequestInput("diff --git a/x b/x\n", [file()]);
    expect(result.diffTruncated).toBe(false);
    expect(result.changedFilesTruncated).toBe(false);
    expect(result.diffText).toBe("diff --git a/x b/x\n");
    expect(result.changedFiles).toHaveLength(1);
    expect(result.totalChangedFileCount).toBe(1);
  });

  it("truncates a diff over the byte limit and appends a marker", () => {
    const diffText = "x".repeat(1000);
    const result = hardenPullRequestInput(diffText, [], { maxDiffBytes: 100, maxChangedFiles: 300 });

    expect(result.diffTruncated).toBe(true);
    expect(Buffer.byteLength(result.diffText, "utf8")).toBeLessThan(1000);
    expect(result.diffText).toContain("ShipSafe: diff truncated");
  });

  it("does not truncate a diff exactly at the byte limit", () => {
    const diffText = "x".repeat(100);
    const result = hardenPullRequestInput(diffText, [], { maxDiffBytes: 100, maxChangedFiles: 300 });
    expect(result.diffTruncated).toBe(false);
    expect(result.diffText).toBe(diffText);
  });

  it("backs up to the previous newline so truncation never cuts mid-line", () => {
    // The 40-byte cutoff lands partway through "+full line two" — the
    // truncated result must drop that partial line entirely rather than
    // keeping a mangled fragment of it.
    const diffText = "@@ -1,3 +1,3 @@\n+full line one\n+full line two\n+full line three\n";
    const result = hardenPullRequestInput(diffText, [], { maxDiffBytes: 40, maxChangedFiles: 300 });

    expect(result.diffTruncated).toBe(true);
    const [beforeMarker] = result.diffText.split("\n\n# ---");
    expect(beforeMarker).toBe("@@ -1,3 +1,3 @@\n+full line one");
  });

  it("caps the changed-file count and reports how many were dropped", () => {
    const files = Array.from({ length: 5 }, (_, i) => file({ filename: `src/${i}.ts` }));
    const result = hardenPullRequestInput("", files, { maxDiffBytes: 1_000_000, maxChangedFiles: 3 });

    expect(result.changedFilesTruncated).toBe(true);
    expect(result.changedFiles).toHaveLength(3);
    expect(result.totalChangedFileCount).toBe(5);
    expect(result.changedFiles.map((f) => f.path)).toEqual(["src/0.ts", "src/1.ts", "src/2.ts"]);
  });

  it("does not mark changedFilesTruncated when the count exactly equals the limit", () => {
    const files = Array.from({ length: 3 }, (_, i) => file({ filename: `src/${i}.ts` }));
    const result = hardenPullRequestInput("", files, { maxDiffBytes: 1_000_000, maxChangedFiles: 3 });
    expect(result.changedFilesTruncated).toBe(false);
    expect(result.changedFiles).toHaveLength(3);
  });

  it("marks a file with no patch as binary in the mapped output", () => {
    const files = [file({ filename: "assets/logo.png", patch: undefined, additions: 0, deletions: 0 })];
    const result = hardenPullRequestInput("", files);
    expect(result.changedFiles[0]).toMatchObject({ path: "assets/logo.png", binary: true });
  });

  it("handles an empty diff and an empty file list without truncating anything", () => {
    const result = hardenPullRequestInput("", []);
    expect(result.diffTruncated).toBe(false);
    expect(result.changedFilesTruncated).toBe(false);
    expect(result.changedFiles).toEqual([]);
    expect(result.totalChangedFileCount).toBe(0);
  });
});
