import { describe, expect, it } from "vitest";
import { ReviewOrchestrator } from "./orchestrator";
import { ProviderError, type AgentReviewInput, type AgentReviewResult, type AIProvider } from "./providers/provider";
import { MockReleaseJudgeProvider } from "./providers/judge-provider";
import type { ReleaseJudgeInput, ReleaseJudgePort, ReleaseJudgeResult } from "./providers/judge-provider";
import type { DiffReviewerKind, ReviewContext } from "./types";

type Behavior =
  | "success"
  | "throw-terminal"
  | "throw-retryable"
  | "throw-retryable-once"
  | "throw-generic"
  | "success-with-p0-finding";

class FakeAIProvider implements AIProvider {
  private readonly callCounts = new Map<DiffReviewerKind, number>();

  constructor(private readonly behavior: Partial<Record<DiffReviewerKind, Behavior>>) {}

  async review(input: AgentReviewInput): Promise<AgentReviewResult> {
    const mode: Behavior = this.behavior[input.reviewer] ?? "success";
    const count = (this.callCounts.get(input.reviewer) ?? 0) + 1;
    this.callCounts.set(input.reviewer, count);

    if (mode === "throw-terminal") {
      throw new ProviderError(`${input.reviewer} terminal failure`, "terminal");
    }
    if (mode === "throw-retryable") {
      throw new ProviderError(`${input.reviewer} retryable failure`, "retryable");
    }
    if (mode === "throw-retryable-once" && count === 1) {
      throw new ProviderError(`${input.reviewer} transient failure`, "retryable");
    }
    if (mode === "throw-generic") {
      throw new Error(`${input.reviewer} unexpected failure`);
    }

    const findings =
      mode === "success-with-p0-finding"
        ? [
            {
              severity: "P0" as const,
              title: `${input.reviewer} found a critical issue`,
              description: "planted by the test fixture",
              filePath: null,
              lineStart: null,
              lineEnd: null,
              category: "test-fixture",
              recommendation: "planted by the test fixture",
              confidence: 1,
            },
          ]
        : [];

    return {
      output: { summary: `${input.reviewer} report`, findings },
      metadata: {
        provider: "fake",
        model: "fake-v1",
        requestId: null,
        inputTokens: null,
        outputTokens: null,
        latencyMs: 1,
        attempt: input.attempt,
      },
    };
  }

  callCountFor(reviewer: DiffReviewerKind): number {
    return this.callCounts.get(reviewer) ?? 0;
  }
}

class AlwaysThrowsJudgeProvider implements ReleaseJudgePort {
  async judge(_input: ReleaseJudgeInput): Promise<ReleaseJudgeResult> {
    throw new Error("judge provider is down");
  }
}

/**
 * Adversarial `ReleaseJudgePort`: always says APPROVE, no matter what
 * it's given. Used to prove that (a) the orchestrator never even calls
 * this when a required reviewer failed — fail-closed is enforced before
 * the judge is invoked, not by trusting the judge to enforce it — and
 * (b) when it IS called, its lenient output can't override the
 * deterministic floor computed from the findings.
 */
class AlwaysApprovesJudgeProvider implements ReleaseJudgePort {
  callCount = 0;

  async judge(input: ReleaseJudgeInput): Promise<ReleaseJudgeResult> {
    this.callCount += 1;
    return {
      output: { verdict: "APPROVE", summary: "Adversarial judge: everything looks great!" },
      metadata: {
        provider: "adversarial",
        model: "always-approve-v1",
        requestId: null,
        inputTokens: null,
        outputTokens: null,
        latencyMs: 0,
        attempt: input.attempt,
      },
    };
  }
}

const context: ReviewContext = {
  pullRequestTitle: "test pr",
  sourceBranch: "feature/x",
  targetBranch: "main",
  changedFiles: [],
  diffText: "",
  diffTruncated: false,
  changedFilesTruncated: false,
};

describe("ReviewOrchestrator — fail-closed orchestration", () => {
  it("completes with APPROVE when every required reviewer succeeds with no findings", async () => {
    const orchestrator = new ReviewOrchestrator(new FakeAIProvider({}), new MockReleaseJudgeProvider());
    const result = await orchestrator.run(context);

    expect(result.status).toBe("complete");
    expect(result.verdict).toBe("APPROVE");
    expect(result.failureReason).toBeNull();
    expect(result.reviewerRuns.every((run) => run.status === "complete")).toBe(true);
  });

  it("fails closed when one required reviewer fails", async () => {
    const orchestrator = new ReviewOrchestrator(
      new FakeAIProvider({ security: "throw-terminal" }),
      new MockReleaseJudgeProvider(),
    );
    const result = await orchestrator.run(context);

    expect(result.status).toBe("failed");
    expect(result.verdict).toBe("DO_NOT_APPROVE");
    expect(result.failureReason).toContain("Security Reviewer");
  });

  it("fails closed and names every reviewer when multiple fail", async () => {
    const orchestrator = new ReviewOrchestrator(
      new FakeAIProvider({ security: "throw-terminal", database: "throw-terminal" }),
      new MockReleaseJudgeProvider(),
    );
    const result = await orchestrator.run(context);

    expect(result.status).toBe("failed");
    expect(result.verdict).toBe("DO_NOT_APPROVE");
    expect(result.failureReason).toContain("Security Reviewer");
    expect(result.failureReason).toContain("Database Reviewer");
  });

  it("fails closed when every required reviewer fails", async () => {
    const orchestrator = new ReviewOrchestrator(
      new FakeAIProvider({
        code: "throw-terminal",
        security: "throw-terminal",
        architecture: "throw-terminal",
        database: "throw-terminal",
        test: "throw-terminal",
      }),
      new MockReleaseJudgeProvider(),
    );
    const result = await orchestrator.run(context);

    expect(result.status).toBe("failed");
    expect(result.verdict).toBe("DO_NOT_APPROVE");
  });

  it("fails closed even when only one reviewer throws and the rest succeed cleanly", async () => {
    const orchestrator = new ReviewOrchestrator(
      new FakeAIProvider({ test: "throw-generic" }),
      new MockReleaseJudgeProvider(),
    );
    const result = await orchestrator.run(context);

    // The other four ran fine (Promise.all didn't short-circuit) — only
    // the one that threw shows up as failed.
    const testRun = result.reviewerRuns.find((run) => run.reviewer === "test");
    expect(testRun?.status).toBe("failed");
    const otherRuns = result.reviewerRuns.filter(
      (run) => run.reviewer !== "test" && run.reviewer !== "judge",
    );
    expect(otherRuns.every((run) => run.status === "complete")).toBe(true);

    expect(result.status).toBe("failed");
    expect(result.verdict).toBe("DO_NOT_APPROVE");
  });

  it("a failed required reviewer can never result in APPROVE, even with zero findings anywhere", async () => {
    const orchestrator = new ReviewOrchestrator(
      new FakeAIProvider({ architecture: "throw-terminal" }),
      new MockReleaseJudgeProvider(),
    );
    const result = await orchestrator.run(context);

    expect(result.verdict).not.toBe("APPROVE");
    expect(result.verdict).toBe("DO_NOT_APPROVE");
  });

  it("a completed review requires every required reviewer to have succeeded", async () => {
    const orchestrator = new ReviewOrchestrator(new FakeAIProvider({}), new MockReleaseJudgeProvider());
    const result = await orchestrator.run(context);

    const requiredReviewers: DiffReviewerKind[] = ["code", "security", "architecture", "database", "test"];
    for (const reviewer of requiredReviewers) {
      const run = result.reviewerRuns.find((r) => r.reviewer === reviewer);
      expect(run?.status).toBe("complete");
    }
    expect(result.status).toBe("complete");
  });

  it("fails closed when the Release Judge itself throws", async () => {
    const orchestrator = new ReviewOrchestrator(new FakeAIProvider({}), new AlwaysThrowsJudgeProvider());
    const result = await orchestrator.run(context);

    expect(result.status).toBe("failed");
    expect(result.verdict).toBe("DO_NOT_APPROVE");
    expect(result.failureReason).toContain("Release Judge failed");

    const judgeRun = result.reviewerRuns.find((run) => run.reviewer === "judge");
    expect(judgeRun?.status).toBe("failed");
    expect(judgeRun?.errorMessage).toContain("judge provider is down");
  });

  it("adversarial: never calls the judge — and stays DO_NOT_APPROVE — when a required reviewer failed, even if the judge would always say APPROVE", async () => {
    const adversarialJudge = new AlwaysApprovesJudgeProvider();
    const orchestrator = new ReviewOrchestrator(
      new FakeAIProvider({ security: "throw-terminal" }),
      adversarialJudge,
    );
    const result = await orchestrator.run(context);

    expect(adversarialJudge.callCount).toBe(0);
    expect(result.status).toBe("failed");
    expect(result.verdict).toBe("DO_NOT_APPROVE");
    expect(result.failureReason).toContain("Security Reviewer");

    const judgeRun = result.reviewerRuns.find((run) => run.reviewer === "judge");
    expect(judgeRun?.status).toBe("pending");
  });

  it("adversarial: clamps an always-APPROVE judge to the deterministic floor when a required reviewer reports a P0 finding", async () => {
    const adversarialJudge = new AlwaysApprovesJudgeProvider();
    const orchestrator = new ReviewOrchestrator(
      new FakeAIProvider({ security: "success-with-p0-finding" }),
      adversarialJudge,
    );
    const result = await orchestrator.run(context);

    // The judge WAS called (all required reviewers succeeded) and it
    // said APPROVE — but the orchestrator's floor must override it.
    expect(adversarialJudge.callCount).toBe(1);
    expect(result.status).toBe("complete");
    expect(result.verdict).toBe("DO_NOT_APPROVE");
    expect(result.verdict).not.toBe("APPROVE");
  });
});

describe("ReviewOrchestrator — provider error retry policy", () => {
  it("retries once on a retryable error and succeeds", async () => {
    const provider = new FakeAIProvider({ code: "throw-retryable-once" });
    const orchestrator = new ReviewOrchestrator(provider, new MockReleaseJudgeProvider());
    const result = await orchestrator.run(context);

    const codeRun = result.reviewerRuns.find((run) => run.reviewer === "code");
    expect(codeRun?.status).toBe("complete");
    expect(codeRun?.providerMetadata?.attempt).toBe(2);
    expect(provider.callCountFor("code")).toBe(2);
    expect(result.status).toBe("complete");
  });

  it("does not retry a terminal error", async () => {
    const provider = new FakeAIProvider({ code: "throw-terminal" });
    const orchestrator = new ReviewOrchestrator(provider, new MockReleaseJudgeProvider());
    const result = await orchestrator.run(context);

    expect(provider.callCountFor("code")).toBe(1);
    const codeRun = result.reviewerRuns.find((run) => run.reviewer === "code");
    expect(codeRun?.status).toBe("failed");
    expect(codeRun?.errorMessage).toContain("terminal failure");
  });

  it("gives up after exhausting retries on a persistently retryable error", async () => {
    const provider = new FakeAIProvider({ code: "throw-retryable" });
    const orchestrator = new ReviewOrchestrator(provider, new MockReleaseJudgeProvider());
    const result = await orchestrator.run(context);

    expect(provider.callCountFor("code")).toBe(2); // 1 initial + 1 retry, then gives up
    const codeRun = result.reviewerRuns.find((run) => run.reviewer === "code");
    expect(codeRun?.status).toBe("failed");
  });

  it("treats an unclassified (non-ProviderError) throw as terminal — never retried", async () => {
    const provider = new FakeAIProvider({ code: "throw-generic" });
    const orchestrator = new ReviewOrchestrator(provider, new MockReleaseJudgeProvider());
    await orchestrator.run(context);

    expect(provider.callCountFor("code")).toBe(1);
  });
});
