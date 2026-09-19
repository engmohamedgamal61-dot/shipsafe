import { describe, expect, it } from "vitest";
import type { Finding, ReviewerRun } from "@/domain/types";
import type { ReleaseJudgeOutput } from "../providers/judge-provider";
import { enforceMinimumVerdictForAnyFinding } from "./judge-normalization";

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

describe("enforceMinimumVerdictForAnyFinding", () => {
  it("leaves APPROVE untouched when there are zero findings", () => {
    const output: ReleaseJudgeOutput = { verdict: "APPROVE", summary: "No issues found." };
    const result = enforceMinimumVerdictForAnyFinding(output, [run()]);
    expect(result.verdict).toBe("APPROVE");
  });

  it("upgrades APPROVE to APPROVE_WITH_MINOR_FIXES when a single Nit exists", () => {
    const output: ReleaseJudgeOutput = { verdict: "APPROVE", summary: "Just a nit." };
    const result = enforceMinimumVerdictForAnyFinding(output, [run({ findings: [finding({ severity: "NIT" })] })]);
    expect(result.verdict).toBe("APPROVE_WITH_MINOR_FIXES");
  });

  it("upgrades APPROVE to APPROVE_WITH_MINOR_FIXES when only a P2 exists", () => {
    const output: ReleaseJudgeOutput = { verdict: "APPROVE", summary: "Just a P2." };
    const result = enforceMinimumVerdictForAnyFinding(output, [run({ findings: [finding({ severity: "P2" })] })]);
    expect(result.verdict).toBe("APPROVE_WITH_MINOR_FIXES");
  });

  it("upgrades APPROVE to APPROVE_WITH_MINOR_FIXES when multiple minor findings exist across reviewers", () => {
    const output: ReleaseJudgeOutput = { verdict: "APPROVE", summary: "A couple of nits." };
    const runs = [
      run({ id: "run-code", reviewer: "code", findings: [finding({ id: "a", severity: "NIT" })] }),
      run({ id: "run-arch", reviewer: "architecture", findings: [finding({ id: "b", severity: "P2" })] }),
    ];
    const result = enforceMinimumVerdictForAnyFinding(output, runs);
    expect(result.verdict).toBe("APPROVE_WITH_MINOR_FIXES");
  });

  it("never touches an already-stricter DO_NOT_APPROVE verdict (P0 case)", () => {
    const output: ReleaseJudgeOutput = { verdict: "DO_NOT_APPROVE", summary: "Critical issue found." };
    const result = enforceMinimumVerdictForAnyFinding(output, [run({ findings: [finding({ severity: "P0" })] })]);
    expect(result.verdict).toBe("DO_NOT_APPROVE");
  });

  it("never touches an already-stricter DO_NOT_APPROVE verdict (confirmed severe P1 security case)", () => {
    const output: ReleaseJudgeOutput = { verdict: "DO_NOT_APPROVE", summary: "Confirmed broken access control." };
    const runs = [run({ reviewer: "security", findings: [finding({ severity: "P1", category: "broken-access-control", confidence: 0.95 })] })];
    const result = enforceMinimumVerdictForAnyFinding(output, runs);
    expect(result.verdict).toBe("DO_NOT_APPROVE");
  });

  it("never escalates a low-confidence P1 that the judge already correctly kept at APPROVE_WITH_MINOR_FIXES", () => {
    const output: ReleaseJudgeOutput = { verdict: "APPROVE_WITH_MINOR_FIXES", summary: "Unconfirmed, low-confidence concern." };
    const runs = [run({ reviewer: "architecture", findings: [finding({ severity: "P1", confidence: 0.2 })] })];
    const result = enforceMinimumVerdictForAnyFinding(output, runs);
    expect(result.verdict).toBe("APPROVE_WITH_MINOR_FIXES");
  });

  it("never inflates a verdict for duplicate same-root-cause findings the judge already correctly weighed once", () => {
    const output: ReleaseJudgeOutput = { verdict: "APPROVE_WITH_MINOR_FIXES", summary: "One shared root cause across two reviewers." };
    const runs = [
      run({ id: "run-code", reviewer: "code", findings: [finding({ id: "a", severity: "P1" })] }),
      run({ id: "run-db", reviewer: "database", findings: [finding({ id: "b", severity: "P1" })] }),
    ];
    const result = enforceMinimumVerdictForAnyFinding(output, runs);
    expect(result.verdict).toBe("APPROVE_WITH_MINOR_FIXES");
  });

  it("never alters the summary text", () => {
    const output: ReleaseJudgeOutput = { verdict: "APPROVE", summary: "Exact original summary text." };
    const result = enforceMinimumVerdictForAnyFinding(output, [run({ findings: [finding({ severity: "NIT" })] })]);
    expect(result.summary).toBe("Exact original summary text.");
  });
});
