import { describe, expect, it } from "vitest";
import { stageStateFor } from "./review-stage-progress";
import type { ReviewerRun } from "@/domain/types";

function run(overrides: Partial<ReviewerRun> = {}): ReviewerRun {
  return {
    id: "run-1",
    reviewId: "review-1",
    reviewer: "code",
    status: "complete",
    summary: "ok",
    errorMessage: null,
    providerMetadata: null,
    startedAt: null,
    completedAt: null,
    findings: [],
    ...overrides,
  };
}

describe("stageStateFor — reviewer-stage progress mapping", () => {
  it("shows 'waiting' for every stage while the review is still pending (queued, nothing started)", () => {
    for (const reviewer of ["code", "security", "architecture", "database", "test", "judge"] as const) {
      expect(stageStateFor(reviewer, "pending", [])).toBe("waiting");
    }
  });

  it("shows the 5 specialists as 'running' and the judge as 'waiting' while the review is running with no run rows yet", () => {
    // reviewer_runs only get persisted once the whole orchestrator run
    // finishes — this is the approximation for the in-between window,
    // grounded in how the orchestrator actually sequences work (5
    // specialists concurrently, judge only after).
    for (const reviewer of ["code", "security", "architecture", "database", "test"] as const) {
      expect(stageStateFor(reviewer, "running", [])).toBe("running");
    }
    expect(stageStateFor("judge", "running", [])).toBe("waiting");
  });

  it("trusts a real run row's own status once one exists, regardless of the overall review status", () => {
    const runs = [run({ reviewer: "code", status: "complete" })];
    expect(stageStateFor("code", "running", runs)).toBe("complete");
  });

  it("maps a run row's 'failed' status to the 'failed' stage state", () => {
    const runs = [run({ reviewer: "security", status: "failed" })];
    expect(stageStateFor("security", "failed", runs)).toBe("failed");
  });

  it("maps a run row's 'running' status to the 'running' stage state", () => {
    const runs = [run({ reviewer: "test", status: "running" })];
    expect(stageStateFor("test", "running", runs)).toBe("running");
  });

  it("maps a judge run row left at 'pending' (skipped by the fail-closed required-reviewer check) to 'waiting'", () => {
    const runs = [run({ reviewer: "judge", status: "pending" })];
    expect(stageStateFor("judge", "failed", runs)).toBe("waiting");
  });

  it("shows every reviewer's real final state once the review completes", () => {
    const runs = [
      run({ reviewer: "code", status: "complete" }),
      run({ reviewer: "security", status: "complete" }),
      run({ reviewer: "architecture", status: "complete" }),
      run({ reviewer: "database", status: "complete" }),
      run({ reviewer: "test", status: "complete" }),
      run({ reviewer: "judge", status: "complete" }),
    ];
    for (const reviewer of ["code", "security", "architecture", "database", "test", "judge"] as const) {
      expect(stageStateFor(reviewer, "complete", runs)).toBe("complete");
    }
  });

  it("shows 'waiting' for a reviewer with no run row once the review reaches a terminal state", () => {
    // e.g. required-reviewer-missing fail-closed: some reviewers never ran.
    expect(stageStateFor("database", "failed", [])).toBe("waiting");
  });
});
