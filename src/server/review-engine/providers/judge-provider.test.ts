import { describe, expect, it } from "vitest";
import { MockReleaseJudgeProvider } from "./judge-provider";
import type { ReviewerRun } from "@/domain/types";

const judge = new MockReleaseJudgeProvider();

function run(overrides: Partial<ReviewerRun> = {}): ReviewerRun {
  return {
    id: "run-1",
    reviewId: "review-1",
    reviewer: "code",
    status: "complete",
    summary: "ok",
    errorMessage: null,
    providerMetadata: null,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    findings: [],
    ...overrides,
  };
}

const ALL_REQUIRED = ["code", "security", "architecture", "database", "test"] as const;

function completeRuns(): ReviewerRun[] {
  return ALL_REQUIRED.map((reviewer) => run({ id: `run-${reviewer}`, reviewer }));
}

describe("MockReleaseJudgeProvider", () => {
  it("approves when every required reviewer completed with no findings", async () => {
    const result = await judge.judge({ reviewerRuns: completeRuns(), attempt: 1 });
    expect(result.output.verdict).toBe("APPROVE");
  });

  it("floors the verdict to DO_NOT_APPROVE when a P0 finding is present", async () => {
    const runs = completeRuns().map((r) =>
      r.reviewer === "security"
        ? run({
            ...r,
            findings: [
              {
                id: "f1",
                reviewerRunId: r.id,
                severity: "P0",
                title: "secret",
                description: "d",
                filePath: null,
                lineStart: null,
                lineEnd: null,
                category: "hardcoded-secret",
              },
            ],
          })
        : r,
    );
    const result = await judge.judge({ reviewerRuns: runs, attempt: 1 });
    expect(result.output.verdict).toBe("DO_NOT_APPROVE");
  });

  it("does NOT fail-close on its own when a required reviewer's run is missing — that policy lives in the orchestrator", async () => {
    // This is deliberate: the provider only ever sees reviewerRuns and
    // their findings. A required reviewer that failed contributes zero
    // findings, so a naive provider (this one) has no way to distinguish
    // "failed" from "found nothing" — which is exactly why
    // ReviewOrchestrator.run() checks `checkRequiredReviewers` BEFORE
    // ever calling this port, rather than trusting the port to do it.
    // See orchestrator.test.ts's adversarial judge tests.
    const runsMissingSecurity = completeRuns().filter((r) => r.reviewer !== "security");
    const result = await judge.judge({ reviewerRuns: runsMissingSecurity, attempt: 1 });
    expect(result.output.verdict).toBe("APPROVE");
  });

  it("returns execution metadata reflecting the given attempt", async () => {
    const result = await judge.judge({ reviewerRuns: completeRuns(), attempt: 2 });
    expect(result.metadata.provider).toBe("mock");
    expect(result.metadata.attempt).toBe(2);
    expect(result.metadata.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
