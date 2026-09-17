import type { ChangedFile, ChangedFileStatus } from "@/domain/types";
import type { GithubPullRequestFile } from "./types";

/**
 * GitHub's file `status` values include a few ShipSafe's domain doesn't
 * model separately (`copied`, `changed`, `unchanged`) — those fall back
 * to `"modified"`, which is the closest honest description ("this file
 * is part of the diff but isn't a pure add/remove/rename").
 */
export function mapGithubFileStatus(status: string): ChangedFileStatus {
  switch (status) {
    case "added":
      return "added";
    case "removed":
      return "removed";
    case "renamed":
      return "renamed";
    case "modified":
    case "copied":
    case "changed":
    case "unchanged":
    default:
      return "modified";
  }
}

export function mapGithubFiles(files: readonly GithubPullRequestFile[]): ChangedFile[] {
  return files.map((file) => ({
    path: file.filename,
    status: mapGithubFileStatus(file.status),
    additions: file.additions,
    deletions: file.deletions,
    // GitHub omits `patch` for a genuinely binary file AND for a text
    // file whose diff was too large to inline — either way, there is no
    // textual patch content for this file anywhere in the PR's diff text,
    // so reviewers have nothing to read for it. See `pr-hardening.ts`.
    binary: file.patch === undefined,
  }));
}
