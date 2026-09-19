import type { ChangedFile } from "@/domain/types";
import type { ReviewContext } from "@/server/review-engine/types";
import type { LoadedFixture } from "../load-fixtures";

/**
 * Builds the exact `ReviewContext` shape production feeds every
 * specialist reviewer, from a Code Reviewer benchmark fixture's full
 * source files. Identical in design to
 * `security-benchmarks/baseline/context.ts` (see that file's own doc
 * comment for the full rationale on the synthetic "new file" diff
 * construction and why its line numbers exactly match the fixture
 * file's own) — kept as an independent copy per
 * `tests/code-benchmarks/README.md`.
 */
export function buildReviewContextFromFixture(fixture: LoadedFixture): ReviewContext {
  const files = fixture.manifest.files.map((path) => buildSyntheticFileDiff(path, fixture.sourceFiles[path] ?? ""));

  return {
    pullRequestTitle: `[code-benchmark] ${fixture.manifest.fixture_id}`,
    sourceBranch: `benchmark/${fixture.manifest.fixture_id}`,
    targetBranch: "main",
    changedFiles: files.map((f) => f.changedFile),
    diffText: files.map((f) => f.diffText).join("\n"),
    diffTruncated: false,
    changedFilesTruncated: false,
  };
}

function buildSyntheticFileDiff(path: string, content: string): { diffText: string; changedFile: ChangedFile } {
  const lines = content.split(/\r?\n/);
  const sourceLines = lines.length > 0 && lines[lines.length - 1] === "" ? lines.slice(0, -1) : lines;

  const diffText = [
    `diff --git a/${path} b/${path}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${path}`,
    `@@ -0,0 +1,${sourceLines.length} @@`,
    ...sourceLines.map((line) => `+${line}`),
  ].join("\n");

  return {
    diffText,
    changedFile: { path, status: "added", additions: sourceLines.length, deletions: 0 },
  };
}
