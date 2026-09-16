import { describe, expect, it } from "vitest";
import {
  applyVerdictFloor,
  checkRequiredReviewers,
  minimumVerdictFor,
  REQUIRED_REVIEWERS,
} from "./verdict";
import { REVIEWER_LABEL, type Finding, type ReviewerKind, type ReviewerRun, type Severity } from "./types";

function finding(severity: Severity, overrides: Partial<Finding> = {}): Finding {
  return {
    id: `finding-${Math.random()}`,
    reviewerRunId: "run-1",
    severity,
    title: "test finding",
    description: "test description",
    filePath: null,
    lineStart: null,
    lineEnd: null,
    category: "test",
    ...overrides,
  };
}

function run(reviewer: ReviewerKind, overrides: Partial<ReviewerRun> = {}): ReviewerRun {
  return {
    id: `run-${reviewer}`,
    reviewId: "review-1",
    reviewer,
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

function allRequiredComplete(): ReviewerRun[] {
  return REQUIRED_REVIEWERS.map((reviewer) => run(reviewer));
}

describe("minimumVerdictFor", () => {
  it("approves when there are no findings", () => {
    expect(minimumVerdictFor([])).toBe("APPROVE");
  });

  it("approves with minor fixes for a single P2 or Nit", () => {
    expect(minimumVerdictFor([finding("P2")])).toBe("APPROVE_WITH_MINOR_FIXES");
    expect(minimumVerdictFor([finding("NIT")])).toBe("APPROVE_WITH_MINOR_FIXES");
  });

  it("approves with minor fixes for one or two P1s", () => {
    expect(minimumVerdictFor([finding("P1")])).toBe("APPROVE_WITH_MINOR_FIXES");
    expect(minimumVerdictFor([finding("P1"), finding("P1")])).toBe(
      "APPROVE_WITH_MINOR_FIXES",
    );
  });

  it("does not approve once three or more P1s accumulate", () => {
    expect(
      minimumVerdictFor([finding("P1"), finding("P1"), finding("P1")]),
    ).toBe("DO_NOT_APPROVE");
  });

  it("always does not approve when a P0 is present, regardless of other findings", () => {
    expect(minimumVerdictFor([finding("P0")])).toBe("DO_NOT_APPROVE");
    expect(minimumVerdictFor([finding("P0"), finding("NIT")])).toBe(
      "DO_NOT_APPROVE",
    );
  });
});

describe("applyVerdictFloor", () => {
  it("overrides a lenient judge verdict when a P0 finding exists", () => {
    const findings = [finding("P0")];
    expect(applyVerdictFloor(findings, "APPROVE")).toBe("DO_NOT_APPROVE");
  });

  it("keeps the judge's stricter verdict when it is stricter than the floor", () => {
    const findings = [finding("NIT")];
    expect(applyVerdictFloor(findings, "DO_NOT_APPROVE")).toBe(
      "DO_NOT_APPROVE",
    );
  });

  it("keeps the judge's verdict when it already matches the floor", () => {
    const findings = [finding("P1")];
    expect(applyVerdictFloor(findings, "APPROVE_WITH_MINOR_FIXES")).toBe(
      "APPROVE_WITH_MINOR_FIXES",
    );
  });

  it("never lets the judge go below the floor for a clean diff", () => {
    expect(applyVerdictFloor([], "APPROVE")).toBe("APPROVE");
  });
});

describe("checkRequiredReviewers", () => {
  it("does not block when every required reviewer completed", () => {
    const result = checkRequiredReviewers(allRequiredComplete());
    expect(result).toEqual({ blocked: false, failureReason: null });
  });

  it("blocks when one required reviewer failed", () => {
    const runs = allRequiredComplete().map((r) =>
      r.reviewer === "security" ? run("security", { status: "failed" }) : r,
    );
    const result = checkRequiredReviewers(runs);
    expect(result.blocked).toBe(true);
    expect(result.failureReason).toContain("Security Reviewer");
  });

  it("blocks and names every failed reviewer when multiple fail", () => {
    const runs = allRequiredComplete().map((r) =>
      r.reviewer === "security" || r.reviewer === "database"
        ? run(r.reviewer, { status: "failed" })
        : r,
    );
    const result = checkRequiredReviewers(runs);
    expect(result.blocked).toBe(true);
    expect(result.failureReason).toContain("Security Reviewer");
    expect(result.failureReason).toContain("Database Reviewer");
  });

  it("blocks when every required reviewer failed", () => {
    const runs = REQUIRED_REVIEWERS.map((reviewer) => run(reviewer, { status: "failed" }));
    const result = checkRequiredReviewers(runs);
    expect(result.blocked).toBe(true);
    for (const reviewer of REQUIRED_REVIEWERS) {
      expect(result.failureReason).toContain(REVIEWER_LABEL[reviewer]);
    }
  });

  it("blocks when a required reviewer's run is missing entirely", () => {
    const runs = allRequiredComplete().filter((r) => r.reviewer !== "test");
    const result = checkRequiredReviewers(runs);
    expect(result.blocked).toBe(true);
    expect(result.failureReason).toContain("Test Reviewer");
  });

  it("does not block on a failed judge run — the judge is not a required reviewer", () => {
    const runs = [...allRequiredComplete(), run("judge", { status: "failed" })];
    const result = checkRequiredReviewers(runs);
    expect(result.blocked).toBe(false);
  });

  it("a failed required reviewer forces a DO_NOT_APPROVE floor even with zero findings", () => {
    // Zero findings would normally floor to APPROVE — checkRequiredReviewers
    // is what the orchestrator/judge must consult in addition to findings.
    expect(minimumVerdictFor([])).toBe("APPROVE");
    const runs = allRequiredComplete().map((r) =>
      r.reviewer === "code" ? run("code", { status: "failed" }) : r,
    );
    expect(checkRequiredReviewers(runs).blocked).toBe(true);
  });
});
