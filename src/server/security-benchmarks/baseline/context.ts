import type { ChangedFile } from "@/domain/types";
import type { ReviewContext } from "@/server/review-engine/types";
import type { LoadedFixture } from "../load-fixtures";

/**
 * Builds the exact `ReviewContext` shape production feeds every
 * specialist reviewer (`src/server/review-engine/types.ts`) from a
 * benchmark fixture's full source files — matching the benchmark plan's
 * §5.3 requirement ("same input contract for the benchmark as for
 * production, so results predict production behavior").
 *
 * Fixtures store whole files, not real PR diffs, so each file is
 * represented as a synthetic "new file" unified diff — every line is a
 * `+` addition, numbered from 1. This is deliberate, not an
 * approximation of convenience: it makes the diff's new-file line
 * numbers identical to the fixture file's own line numbers, which is
 * exactly what every fixture's `expected.json` `line_ranges` were
 * authored against (see e.g. `access-control-01`'s `route.ts` lines
 * 8–14, which are that file's actual line numbers). A reviewer citing
 * "line 8" against this synthetic diff and a human reading the fixture
 * file directly are pointing at the same line.
 */
export function buildReviewContextFromFixture(fixture: LoadedFixture): ReviewContext {
  const files = fixture.manifest.files.map((path) => buildSyntheticFileDiff(path, fixture.sourceFiles[path] ?? ""));

  return {
    pullRequestTitle: `[security-benchmark] ${fixture.manifest.fixture_id}`,
    sourceBranch: `benchmark/${fixture.manifest.fixture_id}`,
    targetBranch: "main",
    changedFiles: files.map((f) => f.changedFile),
    diffText: files.map((f) => f.diffText).join("\n"),
    // This IS the whole fixture — nothing was cut short to build it.
    diffTruncated: false,
    changedFilesTruncated: false,
  };
}

function buildSyntheticFileDiff(path: string, content: string): { diffText: string; changedFile: ChangedFile } {
  const lines = content.split(/\r?\n/);
  // A file ending in a trailing newline splits into a trailing "" —
  // drop it so it isn't counted as an extra (blank) added line.
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
