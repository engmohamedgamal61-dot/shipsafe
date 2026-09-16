/**
 * Minimal unified-diff parser. Good enough to answer "which file and
 * line number did this added line land on", which is what every
 * heuristic agent needs to attach a `filePath`/`lineStart` to a finding.
 *
 * Not a general-purpose diff library — it only tracks what the review
 * engine needs (added lines with their new-file line numbers, grouped by
 * file).
 */

export interface DiffLine {
  /** Line number in the *new* version of the file (added/context lines only). */
  lineNumber: number;
  content: string;
}

export interface DiffFile {
  path: string;
  addedLines: DiffLine[];
  removedLines: string[];
  additions: number;
  deletions: number;
}

const FILE_HEADER = /^\+\+\+ (?:b\/)?(.+)$/;
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function parseUnifiedDiff(diffText: string): DiffFile[] {
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  let newLineNum = 0;

  for (const line of diffText.split("\n")) {
    const fileMatch = FILE_HEADER.exec(line);
    if (fileMatch) {
      if (fileMatch[1] === "/dev/null") {
        current = null;
        continue;
      }
      current = {
        path: fileMatch[1],
        addedLines: [],
        removedLines: [],
        additions: 0,
        deletions: 0,
      };
      files.push(current);
      continue;
    }

    const hunkMatch = HUNK_HEADER.exec(line);
    if (hunkMatch) {
      newLineNum = Number(hunkMatch[1]);
      continue;
    }

    if (!current) continue;

    if (line.startsWith("+") && !line.startsWith("+++")) {
      current.addedLines.push({ lineNumber: newLineNum, content: line.slice(1) });
      current.additions += 1;
      newLineNum += 1;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      current.removedLines.push(line.slice(1));
      current.deletions += 1;
    } else if (line.startsWith(" ")) {
      newLineNum += 1;
    }
  }

  return files;
}
