import path from "node:path";
import { describe, expect, it } from "vitest";
import { computeDeferredMetrics, type DeferredMetricResult } from "./deferred-metrics";
import { BENCHMARK_ROOT, loadFixture } from "./load-fixtures";
import { producedFindingSchema, reviewerResultSchema, scoreFixture, type ProducedFinding } from "./scorer";

/** Narrows to the `not_measurable` branch (asserting it, not just checking) so `.reason` is accessible without an `if` in every test. */
function expectNotMeasurable(result: DeferredMetricResult): asserts result is { status: "not_measurable"; reason: string } {
  expect(result.status).toBe("not_measurable");
}

const accessControlVulnerable = loadFixture(
  path.join(BENCHMARK_ROOT, "access-control", "01-idor-service-role-no-owner-check"),
);

function finding(overrides: Partial<ProducedFinding>): ProducedFinding {
  return producedFindingSchema.parse({
    category: "access-control.idor",
    severity: "P0",
    confidence: "high",
    file: "route.ts",
    lineStart: 8,
    lineEnd: 14,
    evidence: "",
    ...overrides,
  });
}

describe("computeDeferredMetrics (Task 6)", () => {
  it("always reports not_measurable for all three metrics — never a fabricated score", () => {
    const score = scoreFixture(
      accessControlVulnerable,
      reviewerResultSchema.parse({ findings: [finding({})] }),
    );
    const metrics = computeDeferredMetrics([score]);

    expect(metrics.exploitPathValidity.status).toBe("not_measurable");
    expect(metrics.standardsMappingAccuracy.status).toBe("not_measurable");
    expect(metrics.remediationQuality.status).toBe("not_measurable");
  });

  it("exploitPathValidity's reason names the field-absence case when no finding supplies the chain fields", () => {
    const score = scoreFixture(accessControlVulnerable, reviewerResultSchema.parse({ findings: [] }));
    const metrics = computeDeferredMetrics([score]);
    expectNotMeasurable(metrics.exploitPathValidity);
    expect(metrics.exploitPathValidity.reason).toMatch(/does not emit/);
  });

  it("exploitPathValidity's reason surfaces a manual-review count when chain fields ARE present, still without a fabricated score", () => {
    const score = scoreFixture(
      accessControlVulnerable,
      reviewerResultSchema.parse({
        findings: [
          finding({
            securityConsequence: "Any authenticated caller can read another workspace's data.",
            attackPreconditions: "None.",
            exploitScenario: "Attacker requests the endpoint with a guessed id.",
          }),
        ],
      }),
    );
    const metrics = computeDeferredMetrics([score]);
    expectNotMeasurable(metrics.exploitPathValidity);
    expect(metrics.exploitPathValidity.reason).toMatch(/manual spot-check required/);
  });

  it("standardsMappingAccuracy's reason distinguishes 'none supplied' from 'supplied but unverified'", () => {
    const noneSupplied = computeDeferredMetrics([
      scoreFixture(accessControlVulnerable, reviewerResultSchema.parse({ findings: [] })),
    ]);
    expectNotMeasurable(noneSupplied.standardsMappingAccuracy);
    expect(noneSupplied.standardsMappingAccuracy.reason).toMatch(/No produced finding/);

    const supplied = computeDeferredMetrics([
      scoreFixture(
        accessControlVulnerable,
        reviewerResultSchema.parse({
          findings: [finding({ standards: [{ framework: "cwe", id: "CWE-862" }] })],
        }),
      ),
    ]);
    expectNotMeasurable(supplied.standardsMappingAccuracy);
    expect(supplied.standardsMappingAccuracy.reason).toMatch(/1 finding\(s\) supply/);
  });

  it("remediationQuality is always not_measurable regardless of input, since ProducedFinding has no remediation field", () => {
    const metrics = computeDeferredMetrics([]);
    expectNotMeasurable(metrics.remediationQuality);
    expect(metrics.remediationQuality.reason).toMatch(/remediation/);
  });
});
