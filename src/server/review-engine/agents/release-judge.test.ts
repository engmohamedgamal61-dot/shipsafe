import { describe, expect, it } from "vitest";
import type { Finding, ReviewerRun } from "@/domain/types";
import type { ReleaseJudgeInput, ReleaseJudgePort, ReleaseJudgeResult } from "../providers/judge-provider";
import { ReleaseJudgeAgent } from "./release-judge";

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "f1",
    reviewerRunId: "run-1",
    severity: "P1",
    title: "Finding",
    description: "d",
    filePath: null,
    lineStart: null,
    lineEnd: null,
    category: "c",
    recommendation: "r",
    confidence: 0.9,
    ...overrides,
  };
}

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

class StubPort implements ReleaseJudgePort {
  public lastInput: ReleaseJudgeInput | null = null;
  constructor(private readonly result: ReleaseJudgeResult) {}

  async judge(input: ReleaseJudgeInput): Promise<ReleaseJudgeResult> {
    this.lastInput = input;
    return this.result;
  }
}

function resultOf(verdict: ReleaseJudgeResult["output"]["verdict"], summary: string): ReleaseJudgeResult {
  return {
    output: { verdict, summary },
    metadata: { provider: "stub", model: "stub", requestId: null, inputTokens: null, outputTokens: null, latencyMs: 0, attempt: 1 },
  };
}

describe("ReleaseJudgeAgent", () => {
  it("returns APPROVE unchanged for zero findings", async () => {
    const agent = new ReleaseJudgeAgent(new StubPort(resultOf("APPROVE", "No issues found.")));
    const result = await agent.judge([run()], 1);
    expect(result.output.verdict).toBe("APPROVE");
  });

  it("upgrades a raw APPROVE to APPROVE_WITH_MINOR_FIXES when a Nit-only finding exists", async () => {
    const agent = new ReleaseJudgeAgent(new StubPort(resultOf("APPROVE", "Just a nit.")));
    const result = await agent.judge([run({ findings: [finding({ severity: "NIT" })] })], 1);
    expect(result.output.verdict).toBe("APPROVE_WITH_MINOR_FIXES");
  });

  it("upgrades a raw APPROVE to APPROVE_WITH_MINOR_FIXES when a P2-only finding exists", async () => {
    const agent = new ReleaseJudgeAgent(new StubPort(resultOf("APPROVE", "Just a P2.")));
    const result = await agent.judge([run({ findings: [finding({ severity: "P2" })] })], 1);
    expect(result.output.verdict).toBe("APPROVE_WITH_MINOR_FIXES");
  });

  it("upgrades a raw APPROVE to APPROVE_WITH_MINOR_FIXES when multiple minor findings exist across reviewers", async () => {
    const agent = new ReleaseJudgeAgent(new StubPort(resultOf("APPROVE", "A couple of nits.")));
    const runs = [
      run({ id: "run-code", reviewer: "code", findings: [finding({ id: "a", severity: "NIT" })] }),
      run({ id: "run-arch", reviewer: "architecture", findings: [finding({ id: "b", severity: "P2" })] }),
    ];
    const result = await agent.judge(runs, 1);
    expect(result.output.verdict).toBe("APPROVE_WITH_MINOR_FIXES");
  });

  it("preserves DO_NOT_APPROVE for a P0 finding", async () => {
    const agent = new ReleaseJudgeAgent(new StubPort(resultOf("DO_NOT_APPROVE", "Critical P0 issue.")));
    const result = await agent.judge([run({ findings: [finding({ severity: "P0" })] })], 1);
    expect(result.output.verdict).toBe("DO_NOT_APPROVE");
  });

  it("preserves DO_NOT_APPROVE for a confirmed severe P1 security finding", async () => {
    const agent = new ReleaseJudgeAgent(new StubPort(resultOf("DO_NOT_APPROVE", "Confirmed broken access control must be fixed before release.")));
    const runs = [run({ reviewer: "security", findings: [finding({ severity: "P1", category: "broken-access-control", confidence: 0.95 })] })];
    const result = await agent.judge(runs, 1);
    expect(result.output.verdict).toBe("DO_NOT_APPROVE");
  });

  it("does not over-escalate a low-confidence P1 the port already correctly kept at APPROVE_WITH_MINOR_FIXES", async () => {
    const agent = new ReleaseJudgeAgent(new StubPort(resultOf("APPROVE_WITH_MINOR_FIXES", "Unconfirmed, low-confidence concern; not a confirmed blocker.")));
    const runs = [run({ reviewer: "architecture", findings: [finding({ severity: "P1", confidence: 0.2 })] })];
    const result = await agent.judge(runs, 1);
    expect(result.output.verdict).toBe("APPROVE_WITH_MINOR_FIXES");
  });

  it("does not inflate the verdict for duplicate same-root-cause findings the port already weighed once", async () => {
    const agent = new ReleaseJudgeAgent(new StubPort(resultOf("APPROVE_WITH_MINOR_FIXES", "One shared root cause across two reviewers.")));
    const runs = [
      run({ id: "run-code", reviewer: "code", findings: [finding({ id: "a", severity: "P1" })] }),
      run({ id: "run-db", reviewer: "database", findings: [finding({ id: "b", severity: "P1" })] }),
    ];
    const result = await agent.judge(runs, 1);
    expect(result.output.verdict).toBe("APPROVE_WITH_MINOR_FIXES");
  });

  it("never invents findings — the output shape has only verdict and summary, and the summary is passed through untouched", async () => {
    const port = new StubPort(resultOf("APPROVE_WITH_MINOR_FIXES", "Exact original summary, mentioning only the one real finding."));
    const agent = new ReleaseJudgeAgent(port);
    const result = await agent.judge([run({ findings: [finding()] })], 1);
    expect(Object.keys(result.output).sort()).toEqual(["summary", "verdict"]);
    expect(result.output.summary).toBe("Exact original summary, mentioning only the one real finding.");
  });

  it("passes reviewerRuns through to the port unchanged", async () => {
    const port = new StubPort(resultOf("APPROVE", "ok"));
    const agent = new ReleaseJudgeAgent(port);
    const runs = [run()];
    await agent.judge(runs, 2);
    expect(port.lastInput?.reviewerRuns).toEqual(runs);
    expect(port.lastInput?.attempt).toBe(2);
  });
});
