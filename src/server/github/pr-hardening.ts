import type { ChangedFile } from "@/domain/types";
import type { GithubPullRequestFile } from "./types";
import { mapGithubFiles } from "./mappers";

/**
 * Hard ceilings applied to every PR ingested from GitHub before its diff
 * text and file list are persisted or handed to the review engine.
 *
 * A PR's diff and file list are authored by whoever can push to the
 * source branch of a connected repository — not by this deployment — so
 * they're untrusted input like any other external payload: bounded here
 * rather than trusted to be a reasonable size just because they came from
 * GitHub's own API.
 */
export const MAX_DIFF_BYTES = 2_000_000; // ~2MB of unified diff text
export const MAX_CHANGED_FILES = 300;

export interface PullRequestIngestLimits {
  maxDiffBytes: number;
  maxChangedFiles: number;
}

const DEFAULT_LIMITS: PullRequestIngestLimits = {
  maxDiffBytes: MAX_DIFF_BYTES,
  maxChangedFiles: MAX_CHANGED_FILES,
};

export interface HardenedPullRequestInput {
  diffText: string;
  changedFiles: ChangedFile[];
  /** True when `diffText` was cut short of GitHub's full diff. */
  diffTruncated: boolean;
  /** True when `changedFiles` is a prefix of GitHub's full file list. */
  changedFilesTruncated: boolean;
  /** How many files GitHub reported, before any truncation. */
  totalChangedFileCount: number;
}

/**
 * Cuts `diffText` to at most `maxBytes` UTF-8 bytes, backing up to the
 * previous newline so the result never ends mid-line — a parser reading a
 * truncated hunk header is worse than one reading no hunk at all. Appends
 * a marker line (itself part of the returned diff text, so it's visible
 * anywhere that text is displayed or fed to a reviewer) rather than
 * failing silently.
 */
function truncateDiffText(diffText: string, maxBytes: number): { text: string; truncated: boolean } {
  if (Buffer.byteLength(diffText, "utf8") <= maxBytes) {
    return { text: diffText, truncated: false };
  }

  let cut = Buffer.from(diffText, "utf8").subarray(0, maxBytes).toString("utf8");
  const lastNewline = cut.lastIndexOf("\n");
  if (lastNewline > 0) cut = cut.slice(0, lastNewline);

  return {
    text: `${cut}\n\n# --- ShipSafe: diff truncated at ${maxBytes} bytes; remaining changes were not reviewed. ---\n`,
    truncated: true,
  };
}

/**
 * Applies size/count ceilings to a PR's raw diff text and file list, and
 * maps the (possibly truncated) file list into `ChangedFile[]` — the one
 * place `src/server/github/ingest.ts` should get either from, instead of
 * persisting or reviewing GitHub's response directly.
 */
export function hardenPullRequestInput(
  diffText: string,
  files: readonly GithubPullRequestFile[],
  limits: PullRequestIngestLimits = DEFAULT_LIMITS,
): HardenedPullRequestInput {
  const { text, truncated: diffTruncated } = truncateDiffText(diffText, limits.maxDiffBytes);
  const changedFilesTruncated = files.length > limits.maxChangedFiles;
  const changedFiles = mapGithubFiles(files.slice(0, limits.maxChangedFiles));

  return {
    diffText: text,
    changedFiles,
    diffTruncated,
    changedFilesTruncated,
    totalChangedFileCount: files.length,
  };
}
