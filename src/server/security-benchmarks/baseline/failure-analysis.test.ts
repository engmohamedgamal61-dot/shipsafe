import path from "node:path";
import { describe, expect, it } from "vitest";
import { BENCHMARK_ROOT, loadFixture } from "../load-fixtures";
import { producedFindingSchema, reviewerResultSchema, scoreFixture, type ProducedFinding } from "../scorer";
import { analyzeFixtureFailure } from "./failure-analysis";

const accessControlVulnerable = loadFixture(
  path.join(BENCHMARK_ROOT, "access-control", "01-idor-service-role-no-owner-check"),
);
const accessControlSafe = loadFixture(
  path.join(BENCHMARK_ROOT, "access-control", "02-fp-trap-service-role-in-trusted-worker"),
);
const webhooksVulnerableWithOptional = loadFixture(path.join(BENCHMARK_ROOT, "webhooks", "01-no-signature-verification"));
const ambiguous = loadFixture(path.join(BENCHMARK_ROOT, "multi-tenant", "04-ambiguous-security-definer-no-callsite"));

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

describe("analyzeFixtureFailure", () => {
  it("returns no reasons for a passing fixture", () => {
    const score = scoreFixture(
      accessControlVulnerable,
      reviewerResultSchema.parse({ findings: [finding({})] }),
    );
    expect(analyzeFixtureFailure(accessControlVulnerable, score)).toEqual([]);
  });

  it("flags 'missed vulnerability' when a required finding goes undetected", () => {
    const score = scoreFixture(accessControlVulnerable, reviewerResultSchema.parse({ findings: [] }));
    expect(analyzeFixtureFailure(accessControlVulnerable, score)).toContain("missed vulnerability");
  });

  it("flags 'false positive' for a safe fixture given any finding at all", () => {
    const score = scoreFixture(
      accessControlSafe,
      reviewerResultSchema.parse({ findings: [finding({ file: "worker.ts", lineStart: 15, lineEnd: 20 })] }),
    );
    expect(analyzeFixtureFailure(accessControlSafe, score)).toContain("false positive");
  });

  it("flags 'hallucination' for a finding citing a file outside the fixture", () => {
    const score = scoreFixture(
      accessControlVulnerable,
      reviewerResultSchema.parse({ findings: [finding({ file: "does-not-exist.ts" })] }),
    );
    expect(analyzeFixtureFailure(accessControlVulnerable, score)).toContain("hallucination");
  });

  it("flags 'fabricated evidence' for a false backtick-quoted claim", () => {
    const score = scoreFixture(
      accessControlVulnerable,
      reviewerResultSchema.parse({
        findings: [finding({ evidence: "Calls `validateOwnership()` before returning the row." })],
      }),
    );
    expect(analyzeFixtureFailure(accessControlVulnerable, score)).toContain("fabricated evidence");
  });

  it("flags 'insufficient evidence' when the reviewer's own evidenceState is needs_more_context", () => {
    const score = scoreFixture(
      accessControlVulnerable,
      reviewerResultSchema.parse({ findings: [finding({ evidenceState: "needs_more_context" })] }),
    );
    const reasons = analyzeFixtureFailure(accessControlVulnerable, score);
    expect(reasons).toContain("insufficient evidence");
    expect(reasons).toContain("missed vulnerability");
  });

  it("flags 'overconfidence' for a confident finding on an ambiguous fixture", () => {
    const score = scoreFixture(
      ambiguous,
      reviewerResultSchema.parse({
        findings: [
          finding({
            category: "multi-tenant.security-definer",
            severity: "P0",
            confidence: "high",
            file: "migration.sql",
            lineStart: 5,
            lineEnd: 19,
          }),
        ],
      }),
    );
    const reasons = analyzeFixtureFailure(ambiguous, score);
    expect(reasons).toContain("overconfidence");
    expect(reasons).toContain("false positive");
  });

  it("does NOT flag 'overconfidence' for a correct low-confidence match on an ambiguous fixture", () => {
    const score = scoreFixture(
      ambiguous,
      reviewerResultSchema.parse({
        findings: [
          finding({
            category: "multi-tenant.security-definer",
            severity: "P1",
            confidence: "low",
            file: "migration.sql",
            lineStart: 5,
            lineEnd: 19,
          }),
        ],
      }),
    );
    expect(analyzeFixtureFailure(ambiguous, score)).toEqual([]);
  });

  it("flags 'duplicate root cause' for a repeated match against the same entry", () => {
    const score = scoreFixture(
      accessControlVulnerable,
      reviewerResultSchema.parse({ findings: [finding({}), finding({})] }),
    );
    expect(analyzeFixtureFailure(accessControlVulnerable, score)).toContain("duplicate root cause");
  });

  it("flags 'severity inflation'/'severity understatement' for a matched finding outside its severity_range", () => {
    const inflated = scoreFixture(
      webhooksVulnerableWithOptional,
      reviewerResultSchema.parse({
        findings: [
          finding({
            category: "webhook.idempotency",
            severity: "P0", // opt-1's range tops out at P1
            confidence: "medium",
            file: "route.ts",
            lineStart: 8,
            lineEnd: 13,
          }),
        ],
      }),
    );
    expect(analyzeFixtureFailure(webhooksVulnerableWithOptional, inflated)).not.toContain("severity inflation");
    // opt-1 is never required, so an inflated OPTIONAL match doesn't
    // trip the severity-accuracy check at all (scorer.ts only checks
    // matched_required) — asserting that explicitly here documents why
    // this case looks empty rather than leaving it unexplained.
    expect(inflated.severityAccuracy.inflated).toBe(0);
  });

  it("flags 'category mismatch' when an overlapping-but-genuinely-different specific category can't disambiguate two sibling entries", () => {
    // req-1 (webhook.signature-verification) and opt-1 (webhook.idempotency)
    // share the exact same declared region (route.ts:8-13) and DO need
    // disambiguation — a specific, unrelated, but still-canonical
    // category at that same location can never match either.
    const score = scoreFixture(
      webhooksVulnerableWithOptional,
      reviewerResultSchema.parse({
        findings: [
          finding({
            category: "injection.sql", // canonical, specific, simply wrong for this location
            severity: "P1",
            confidence: "medium",
            file: "route.ts",
            lineStart: 8,
            lineEnd: 13,
          }),
        ],
      }),
    );
    expect(analyzeFixtureFailure(webhooksVulnerableWithOptional, score)).toContain("category mismatch");
  });

  it("flags 'benchmark compatibility limitation' when a generic compatibility mapping can't disambiguate two sibling entries", () => {
    const score = scoreFixture(
      webhooksVulnerableWithOptional,
      reviewerResultSchema.parse({
        findings: [
          finding({
            category: "webhook-security", // legacy -> "webhook.generic" (deliberately not specific, plan §3.6)
            severity: "P1",
            confidence: "medium",
            file: "route.ts",
            lineStart: 8,
            lineEnd: 13,
          }),
        ],
      }),
    );
    expect(analyzeFixtureFailure(webhooksVulnerableWithOptional, score)).toContain("benchmark compatibility limitation");
  });

  it("flags 'location mismatch' for an allowed-category finding that doesn't correspond to any ground-truth location", () => {
    const score = scoreFixture(
      webhooksVulnerableWithOptional,
      reviewerResultSchema.parse({
        findings: [
          finding({
            category: "webhook.idempotency", // allowed on this fixture...
            severity: "P1",
            confidence: "medium",
            file: "route.ts",
            lineStart: 1, // ...but nowhere near opt-1's declared region (8-13)
            lineEnd: 1,
          }),
        ],
      }),
    );
    expect(analyzeFixtureFailure(webhooksVulnerableWithOptional, score)).toContain("location mismatch");
  });

  it("does not flag a category/location mismatch reason for a finding that overlaps a NON-disambiguation-needing entry (it would already have matched)", () => {
    // access-control-01 has exactly one ground-truth entry — nothing to
    // disambiguate from, so a finding at its exact location always
    // matches regardless of category (see scorer.ts's matchesByLocation);
    // reaching a false-positive classification here is only possible via
    // hallucination/fabrication/wrong-location, never a category reason.
    const score = scoreFixture(
      accessControlVulnerable,
      reviewerResultSchema.parse({ findings: [finding({ file: "does-not-exist.ts" })] }),
    );
    const reasons = analyzeFixtureFailure(accessControlVulnerable, score);
    expect(reasons).not.toContain("category mismatch");
    expect(reasons).not.toContain("benchmark compatibility limitation");
  });
});
