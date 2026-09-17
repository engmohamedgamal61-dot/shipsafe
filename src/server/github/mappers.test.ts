import { describe, expect, it } from "vitest";
import { mapGithubFileStatus, mapGithubFiles } from "./mappers";

describe("mapGithubFileStatus", () => {
  it("maps the core statuses through unchanged", () => {
    expect(mapGithubFileStatus("added")).toBe("added");
    expect(mapGithubFileStatus("removed")).toBe("removed");
    expect(mapGithubFileStatus("renamed")).toBe("renamed");
    expect(mapGithubFileStatus("modified")).toBe("modified");
  });

  it("falls back to modified for statuses ShipSafe doesn't model separately", () => {
    expect(mapGithubFileStatus("copied")).toBe("modified");
    expect(mapGithubFileStatus("changed")).toBe("modified");
    expect(mapGithubFileStatus("unchanged")).toBe("modified");
  });

  it("falls back to modified for an unrecognized future GitHub status", () => {
    expect(mapGithubFileStatus("some-new-status-github-invents-later")).toBe("modified");
  });
});

describe("mapGithubFiles", () => {
  it("maps GitHub's file list shape into ChangedFile[]", () => {
    const result = mapGithubFiles([
      { filename: "src/a.ts", status: "added", additions: 10, deletions: 0, patch: "@@ ... @@" },
      { filename: "src/b.ts", status: "removed", additions: 0, deletions: 5, patch: "@@ ... @@" },
    ]);

    expect(result).toEqual([
      { path: "src/a.ts", status: "added", additions: 10, deletions: 0, binary: false },
      { path: "src/b.ts", status: "removed", additions: 0, deletions: 5, binary: false },
    ]);
  });

  it("returns an empty array for an empty file list", () => {
    expect(mapGithubFiles([])).toEqual([]);
  });

  it("marks a file with no patch as binary", () => {
    const result = mapGithubFiles([
      { filename: "assets/logo.png", status: "added", additions: 0, deletions: 0 },
    ]);
    expect(result).toEqual([
      { path: "assets/logo.png", status: "added", additions: 0, deletions: 0, binary: true },
    ]);
  });

  it("marks a file with a patch as not binary", () => {
    const result = mapGithubFiles([
      { filename: "src/a.ts", status: "modified", additions: 1, deletions: 1, patch: "@@ -1 +1 @@" },
    ]);
    expect(result[0].binary).toBe(false);
  });
});
