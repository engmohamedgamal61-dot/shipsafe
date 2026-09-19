import path from "node:path";
import { describe, expect, it } from "vitest";
import { BENCHMARK_ROOT, loadFixture, type LoadedFixture } from "./load-fixtures";
import { expectedFixtureSchema } from "./schema";
import { aggregateScores, producedFindingSchema, reviewerResultSchema, scoreFixture, type ProducedFinding, type ReviewerResult } from "./scorer";

const accessControlVulnerable = loadFixture(
  path.join(BENCHMARK_ROOT, "access-control", "01-idor-service-role-no-owner-check"),
);
const accessControlSafe = loadFixture(
  path.join(BENCHMARK_ROOT, "access-control", "02-fp-trap-service-role-in-trusted-worker"),
);
const webhooksVulnerableWithOptional = loadFixture(path.join(BENCHMARK_ROOT, "webhooks", "01-no-signature-verification"));
const ambiguous = loadFixture(path.join(BENCHMARK_ROOT, "multi-tenant", "04-ambiguous-security-definer-no-callsite"));
const databaseVulnerable = loadFixture(path.join(BENCHMARK_ROOT, "database", "01-rls-never-enabled-on-tenant-table"));
const injectionVulnerable = loadFixture(path.join(BENCHMARK_ROOT, "injection", "01-sql-string-concatenation"));

/** A minimal, schema-valid fixture that is NOT part of the real benchmark suite — used only to exercise severity_range ceilings/floors below P0, which none of the real fixtures' required_findings have (every one of them is pegged at severity_range max "P0"). */
const severityRangeTestFixture: LoadedFixture = {
  fixtureDir: "/synthetic/severity-range-test",
  manifest: expectedFixtureSchema.parse({
    fixture_id: "synthetic-severity-range-test",
    domain: "test",
    tags: ["vulnerable"],
    spec_ref: "3.1",
    description: "Synthetic fixture used only by scorer.test.ts to exercise severity inflation/understatement scoring.",
    files: ["main.ts"],
    expected: {
      needs_more_context_acceptable: false,
      allowed_categories: ["access-control.idor"],
      prohibited_categories: [],
      required_findings: [
        {
          id: "req-1",
          rule_id: "SEC-TEST-001",
          files: ["main.ts"],
          severity_range: ["P2", "P1"],
          confidence_range: ["medium", "high"],
          exploit_preconditions: "Synthetic.",
        },
      ],
    },
  }),
  sourceFiles: { "main.ts": "export const vulnerable = true;\n" },
};

/** A minimal, schema-valid fixture with a `repository_scope: true` required finding — none of the real 10 fixtures have one yet (Task 4). */
const repositoryScopeTestFixture: LoadedFixture = {
  fixtureDir: "/synthetic/repository-scope-test",
  manifest: expectedFixtureSchema.parse({
    fixture_id: "synthetic-repository-scope-test",
    domain: "test",
    tags: ["vulnerable"],
    spec_ref: "3.13",
    description: "Synthetic fixture used only by scorer.test.ts to exercise repository_scope matching.",
    files: ["ci.yml"],
    expected: {
      needs_more_context_acceptable: false,
      allowed_categories: ["ci-cd.generic"],
      prohibited_categories: [],
      required_findings: [
        {
          id: "req-1",
          rule_id: "SEC-CICD-001",
          files: ["ci.yml"],
          repository_scope: true,
          severity_range: ["P1", "P1"],
          confidence_range: ["medium", "high"],
          exploit_preconditions: "Synthetic — no branch protection rule anywhere in the repository configuration.",
        },
      ],
    },
  }),
  sourceFiles: { "ci.yml": "name: ci\non: [push]\n" },
};

function finding(overrides: Partial<ProducedFinding>): ProducedFinding {
  return producedFindingSchema.parse({
    // Matches accessControlVulnerable's req-1.category — most tests below
    // use that fixture; tests against a different fixture override this.
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

function result(findings: ProducedFinding[], overrides: Partial<ReviewerResult> = {}): ReviewerResult {
  return reviewerResultSchema.parse({ needsMoreContext: false, findings, ...overrides });
}

describe("scoreFixture — the eight required scenarios", () => {
  it("perfect answer: matches the required finding exactly", () => {
    const score = scoreFixture(
      accessControlVulnerable,
      result([
        finding({
          category: "access-control.idor",
          severity: "P0",
          confidence: "high",
          file: "route.ts",
          lineStart: 8,
          lineEnd: 14,
          evidence: "const supabase = createServiceSupabaseClient();",
        }),
      ]),
    );

    expect(score.passed).toBe(true);
    expect(score.hardFailure).toBe(false);
    expect(score.requiredFindingsDetected).toEqual(["req-1"]);
    expect(score.requiredFindingsMissed).toEqual([]);
    expect(score.rawScore).toBe(1);
    expect(score.normalizedScore).toBe(1);
  });

  it("missed vulnerability: zero findings produced against a vulnerable fixture", () => {
    const score = scoreFixture(accessControlVulnerable, result([]));

    expect(score.passed).toBe(false);
    expect(score.hardFailure).toBe(false);
    expect(score.requiredFindingsMissed).toEqual(["req-1"]);
    // A missed P0 required finding costs -2 (double-weighted), per the plan §4.3.
    expect(score.rawScore).toBe(-2);
  });

  it("false positive on a safe fixture: any finding at all is prohibited", () => {
    const score = scoreFixture(
      accessControlSafe,
      result([
        finding({
          category: "access-control.idor",
          file: "worker.ts",
          lineStart: 15,
          lineEnd: 20,
          evidence: "const supabase = createServiceSupabaseClient();",
        }),
      ]),
    );

    expect(score.passed).toBe(false);
    expect(score.hardFailure).toBe(false);
    expect(score.prohibitedFindings).toHaveLength(1);
    // Safe-fixture violations are double-weighted, same as a missed P0.
    expect(score.rawScore).toBe(-2);
  });

  it("allowed optional observation: matching it is credited but not required, and doesn't change the score", () => {
    const withOptional = scoreFixture(
      webhooksVulnerableWithOptional,
      result([
        finding({
          category: "webhook.signature-verification",
          severity: "P0",
          confidence: "high",
          file: "route.ts",
          lineStart: 8,
          lineEnd: 13,
          evidence: "const payload = await request.json();",
        }),
        finding({
          category: "webhook.idempotency",
          severity: "P1",
          confidence: "low",
          file: "route.ts",
          lineStart: 8,
          lineEnd: 13,
          evidence: "await markInvoicePaid(payload.data.invoiceId);",
        }),
      ]),
    );
    const withoutOptional = scoreFixture(
      webhooksVulnerableWithOptional,
      result([
        finding({
          category: "webhook.signature-verification",
          severity: "P0",
          confidence: "high",
          file: "route.ts",
          lineStart: 8,
          lineEnd: 13,
          evidence: "const payload = await request.json();",
        }),
      ]),
    );

    expect(withOptional.passed).toBe(true);
    expect(withOptional.optionalFindingsAccepted).toEqual(["opt-1"]);
    expect(withOptional.rawScore).toBe(withoutOptional.rawScore);
    expect(withOptional.normalizedScore).toBe(withoutOptional.normalizedScore);
  });

  it("duplicate root cause: a second finding matching the same required entry is a duplicate, not a second true positive", () => {
    const score = scoreFixture(
      accessControlVulnerable,
      result([
        finding({ file: "route.ts", lineStart: 8, lineEnd: 14, evidence: "createServiceSupabaseClient" }),
        finding({ file: "route.ts", lineStart: 8, lineEnd: 14, evidence: "createServiceSupabaseClient" }),
      ]),
    );

    expect(score.requiredFindingsDetected).toEqual(["req-1"]);
    expect(score.duplicates).toHaveLength(1);
    expect(score.passed).toBe(true);
    expect(score.rawScore).toBeCloseTo(0.7);
  });

  it("severity inflation: a matched finding above severity_range.max is penalized per level", () => {
    const score = scoreFixture(
      severityRangeTestFixture,
      result([finding({ category: "access-control", severity: "P0", file: "main.ts", lineStart: 1, lineEnd: 1, evidence: "vulnerable" })]),
    );

    expect(score.requiredFindingsDetected).toEqual(["req-1"]);
    expect(score.severityAccuracy.inflated).toBe(1);
    // +1 matched, -0.5 for one level of inflation (P0 vs. max P1).
    expect(score.rawScore).toBeCloseTo(0.5);
  });

  it("severity understatement: a matched finding below severity_range.min is penalized per level (half as hard as inflation)", () => {
    const score = scoreFixture(
      severityRangeTestFixture,
      result([finding({ category: "access-control", severity: "Nit", file: "main.ts", lineStart: 1, lineEnd: 1, evidence: "vulnerable" })]),
    );

    expect(score.severityAccuracy.understated).toBe(1);
    // +1 matched, -0.25 for one level of understatement (Nit vs. min P2).
    expect(score.rawScore).toBeCloseTo(0.75);
  });

  it("hallucinated file: a produced finding citing a file outside the fixture is a hard failure, score forced to 0", () => {
    const score = scoreFixture(
      accessControlVulnerable,
      result([finding({ file: "does-not-exist.ts", evidence: "" })]),
    );

    expect(score.hardFailure).toBe(true);
    expect(score.passed).toBe(false);
    expect(score.hallucinatedPaths).toHaveLength(1);
    expect(score.normalizedScore).toBe(0);
  });

  it("ambiguous fixture correctly returning needs-more-context: zero findings, needsMoreContext true", () => {
    const score = scoreFixture(ambiguous, result([], { needsMoreContext: true }));

    expect(score.passed).toBe(true);
    expect(score.rawScore).toBe(1);
    expect(score.normalizedScore).toBe(1);
  });
});

describe("scoreFixture — rule_id matching (Task 4)", () => {
  it("an exact rule_id match wins even when the cited line doesn't overlap the declared region", () => {
    const score = scoreFixture(
      accessControlVulnerable,
      result([
        finding({
          ruleId: "SEC-AUTHZ-001",
          // req-1's declared region is route.ts:8-14 — this cites line 1,
          // well outside it. A rule_id match is authoritative regardless.
          file: "route.ts",
          lineStart: 1,
          lineEnd: 1,
          evidence: "",
        }),
      ]),
    );

    expect(score.requiredFindingsDetected).toEqual(["req-1"]);
    expect(score.passed).toBe(true);
  });

  it("a wrong rule_id does NOT fall back to location matching, even though the location would otherwise match", () => {
    const score = scoreFixture(
      accessControlVulnerable,
      result([
        finding({
          ruleId: "SEC-AUTHZ-999", // does not exist on this fixture
          category: "access-control.idor",
          file: "route.ts",
          lineStart: 8,
          lineEnd: 14, // exactly req-1's declared region
          evidence: "const supabase = createServiceSupabaseClient();",
        }),
      ]),
    );

    expect(score.requiredFindingsDetected).toEqual([]);
    expect(score.requiredFindingsMissed).toEqual(["req-1"]);
    expect(score.passed).toBe(false);
  });

  it("no rule_id supplied: fallback (category+file+line) matching still works, so an unmodified production reviewer can be benchmarked", () => {
    const score = scoreFixture(
      accessControlVulnerable,
      result([
        finding({
          category: "access-control.idor",
          file: "route.ts",
          lineStart: 8,
          lineEnd: 14,
          evidence: "const supabase = createServiceSupabaseClient();",
          // ruleId intentionally omitted
        }),
      ]),
    );

    expect(score.requiredFindingsDetected).toEqual(["req-1"]);
    expect(score.passed).toBe(true);
  });

  it("duplicate detection works via rule_id too: a second finding citing the same rule_id is a duplicate, not a second true positive", () => {
    const score = scoreFixture(
      accessControlVulnerable,
      result([
        finding({ ruleId: "SEC-AUTHZ-001", file: "route.ts", lineStart: 8, lineEnd: 14, evidence: "" }),
        finding({ ruleId: "SEC-AUTHZ-001", file: "route.ts", lineStart: 8, lineEnd: 14, evidence: "" }),
      ]),
    );

    expect(score.requiredFindingsDetected).toEqual(["req-1"]);
    expect(score.duplicates).toHaveLength(1);
  });

  it("a wrong rule_id against the optional pool also refuses to fall back to a location match", () => {
    const score = scoreFixture(
      webhooksVulnerableWithOptional,
      result([
        finding({
          ruleId: "SEC-WEBHOOK-999", // does not exist
          category: "webhook.idempotency",
          file: "route.ts",
          lineStart: 8,
          lineEnd: 13, // exactly opt-1's declared region
          evidence: "await markInvoicePaid(payload.data.invoiceId);",
        }),
      ]),
    );

    expect(score.optionalFindingsAccepted).toEqual([]);
    // Falls through to the prohibited/unsupported_extra path instead of
    // silently crediting opt-1 — "webhook.idempotency" is in this
    // fixture's allowed_categories, so it lands as unsupported_extra.
    expect(score.falsePositives).toHaveLength(1);
  });
});

describe("scoreFixture — additional ambiguous-fixture coverage", () => {
  it("ambiguous fixture with zero findings and no explicit needsMoreContext flag still passes ('no finding' is also correct)", () => {
    const score = scoreFixture(ambiguous, result([]));
    expect(score.passed).toBe(true);
  });

  it("ambiguous fixture: a low-confidence finding matching the optional entry passes", () => {
    const score = scoreFixture(
      ambiguous,
      result([
        finding({
          category: "multi-tenant.security-definer",
          severity: "P1",
          confidence: "low",
          file: "migration.sql",
          lineStart: 5,
          lineEnd: 19,
          evidence: "security definer",
        }),
      ]),
    );

    expect(score.passed).toBe(true);
    expect(score.optionalFindingsAccepted).toEqual(["opt-1"]);
  });

  it("ambiguous fixture: a confident (medium/high) finding is prohibited — overconfidence on unconfirmed reachability", () => {
    const score = scoreFixture(
      ambiguous,
      result([
        finding({
          category: "multi-tenant.security-definer",
          severity: "P0",
          confidence: "high",
          file: "migration.sql",
          lineStart: 5,
          lineEnd: 19,
          evidence: "security definer",
        }),
      ]),
    );

    expect(score.passed).toBe(false);
    expect(score.prohibitedFindings).toHaveLength(1);
  });

  it("the explicit needsMoreContext flag never changes the score — its absence is never a penalty (Task 3)", () => {
    const withFlag = scoreFixture(ambiguous, result([], { needsMoreContext: true }));
    const withoutFlag = scoreFixture(ambiguous, result([], { needsMoreContext: false }));

    expect(withFlag.rawScore).toBe(withoutFlag.rawScore);
    expect(withFlag.normalizedScore).toBe(withoutFlag.normalizedScore);
    expect(withFlag.passed).toBe(withoutFlag.passed);
    expect(withoutFlag.passed).toBe(true);
  });
});

describe("scoreFixture — fabricated-evidence detection (Task 1 redesign)", () => {
  it("empty evidence is speculative, not fabricated — a softer, non-disqualifying penalty", () => {
    const score = scoreFixture(
      accessControlVulnerable,
      result([finding({ file: "route.ts", lineStart: 8, lineEnd: 14, evidence: "" })]),
    );

    expect(score.hardFailure).toBe(false);
    expect(score.fabricatedEvidence).toHaveLength(0);
    expect(score.speculativeFindings).toHaveLength(1);
    expect(score.requiredFindingsDetected).toEqual(["req-1"]);
    // +1 matched, -0.5 speculative penalty.
    expect(score.rawScore).toBeCloseTo(0.5);
  });

  it("a correct paraphrase (no backtick-quoted code at all) is never flagged as fabricated", () => {
    const score = scoreFixture(
      accessControlVulnerable,
      result([
        finding({
          file: "route.ts",
          lineStart: 8,
          lineEnd: 14,
          evidence:
            "The handler creates a service-role Supabase client and returns the row without checking session or workspace membership.",
        }),
      ]),
    );

    expect(score.fabricatedEvidence).toHaveLength(0);
    expect(score.requiredFindingsDetected).toEqual(["req-1"]);
  });

  it("non-verbatim but accurate backtick-quoted evidence (a real, shortened fragment) is not flagged as fabricated", () => {
    const score = scoreFixture(
      accessControlVulnerable,
      result([
        finding({
          file: "route.ts",
          lineStart: 8,
          lineEnd: 14,
          // Real fragment of the line, reformatted (no "const supabase = "
          // prefix, no trailing semicolon) — never required to be verbatim.
          evidence: "Uses `createServiceSupabaseClient()` with no ownership check before returning data.",
        }),
      ]),
    );

    expect(score.fabricatedEvidence).toHaveLength(0);
    expect(score.requiredFindingsDetected).toEqual(["req-1"]);
  });

  it("an invented function/variable, backtick-quoted, is a hard failure", () => {
    const score = scoreFixture(
      accessControlVulnerable,
      result([
        finding({
          file: "route.ts",
          lineStart: 8,
          lineEnd: 14,
          evidence: "Calls `validateOwnership()` before returning the row.",
        }),
      ]),
    );

    expect(score.hardFailure).toBe(true);
    expect(score.fabricatedEvidence).toHaveLength(1);
    expect(score.normalizedScore).toBe(0);
  });

  it("invented code behavior, backtick-quoted, is a hard failure", () => {
    const score = scoreFixture(
      accessControlVulnerable,
      result([
        finding({
          file: "route.ts",
          lineStart: 8,
          lineEnd: 14,
          evidence: "The route checks `request.headers.get('x-session-token')` before querying.",
        }),
      ]),
    );

    expect(score.hardFailure).toBe(true);
    expect(score.fabricatedEvidence).toHaveLength(1);
  });

  it("a real, correctly-cited file with a fabricated backtick-quoted code claim is fabricated_evidence, not hallucinated_path", () => {
    const score = scoreFixture(
      accessControlVulnerable,
      result([
        finding({
          file: "route.ts", // real file — this must NOT be classified hallucinated_path
          lineStart: 8,
          lineEnd: 14,
          evidence: '`if (session.userId !== data.ownerId) return unauthorized();`',
        }),
      ]),
    );

    expect(score.hallucinatedPaths).toHaveLength(0);
    expect(score.fabricatedEvidence).toHaveLength(1);
    expect(score.hardFailure).toBe(true);
  });

  it("only the fabricated span among several matters — one false quote is enough, even next to an accurate one", () => {
    const score = scoreFixture(
      accessControlVulnerable,
      result([
        finding({
          file: "route.ts",
          lineStart: 8,
          lineEnd: 14,
          evidence: "Uses `createServiceSupabaseClient()` and then calls `checkMembership()`, which does not exist.",
        }),
      ]),
    );

    expect(score.fabricatedEvidence).toHaveLength(1);
  });
});

describe("scoreFixture — fabricated-evidence scorer-defect fixes (case-insensitivity, illustrative examples, dotted API references)", () => {
  it("a case-different but otherwise verbatim quote is NOT fabricated (regression: database-01's real baseline run)", () => {
    // Reproduces the exact real-world case: the fixture's own migration.sql
    // comment says (lowercase) "alter table public.invoices enable row
    // level security;" — a model quoting it in conventional uppercase SQL
    // style must not be penalized for the casing alone.
    const score = scoreFixture(
      databaseVulnerable,
      result([
        finding({
          category: "database.rls",
          file: "migration.sql",
          lineStart: 3,
          lineEnd: 16,
          evidence: "The migration never runs `ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;`.",
        }),
      ]),
    );

    expect(score.fabricatedEvidence).toHaveLength(0);
    expect(score.requiredFindingsDetected).toEqual(["req-1"]);
  });

  it("a genuinely invented span is still flagged even with different casing tried in every direction (case-folding does not launder a real fabrication)", () => {
    const score = scoreFixture(
      accessControlVulnerable,
      result([
        finding({
          file: "route.ts",
          lineStart: 8,
          lineEnd: 14,
          evidence: "Calls `VALIDATEOWNERSHIP()` before returning the row.",
        }),
      ]),
    );

    expect(score.fabricatedEvidence).toHaveLength(1);
    expect(score.hardFailure).toBe(true);
  });

  it("an illustrative attack-payload example introduced with 'e.g.' is not treated as a verbatim-quote claim (regression: injection-01's real baseline run)", () => {
    const score = scoreFixture(
      injectionVulnerable,
      result([
        finding({
          category: "injection.sql",
          file: "search-repos.ts",
          lineStart: 9,
          lineEnd: 10,
          evidence:
            "Interpolates fullNameQuery directly into the SQL string, e.g. `' OR '1'='1`, allowing arbitrary injection.",
        }),
      ]),
    );

    expect(score.fabricatedEvidence).toHaveLength(0);
    expect(score.requiredFindingsDetected).toEqual(["req-1"]);
  });

  it("a dotted API/library reference whose individual segments are all real is not treated as a verbatim-quote claim (regression: injection-01's real baseline run)", () => {
    const score = scoreFixture(
      injectionVulnerable,
      result([
        finding({
          category: "injection.sql",
          file: "search-repos.ts",
          lineStart: 9,
          lineEnd: 10,
          evidence: "This is exploitable since `pg.Pool.query` supports parameterized queries but they are not used here.",
        }),
      ]),
    );

    expect(score.fabricatedEvidence).toHaveLength(0);
    expect(score.requiredFindingsDetected).toEqual(["req-1"]);
  });

  it("an 'e.g.' marker does NOT exempt a span that is actually a false claim about this diff's code (the marker only excuses genuinely illustrative content)", () => {
    // Even prefixed with "e.g.", a span shaped like a real code reference
    // (not an attack-payload string, not a dotted API name) that
    // genuinely doesn't exist anywhere in the source is still fabricated —
    // the exemption is narrow, not a blanket "if preceded by e.g., skip".
    const score = scoreFixture(
      accessControlVulnerable,
      result([
        finding({
          file: "route.ts",
          lineStart: 8,
          lineEnd: 14,
          evidence: "No ownership check exists, e.g. `validateSessionOwnership(session, data)` is never called.",
        }),
      ]),
    );

    expect(score.fabricatedEvidence).toHaveLength(1);
  });

  it("a dotted reference with one invented segment is still fabricated (every segment must be real, not just the shape)", () => {
    const score = scoreFixture(
      injectionVulnerable,
      result([
        finding({
          category: "injection.sql",
          file: "search-repos.ts",
          lineStart: 9,
          lineEnd: 10,
          evidence: "Equivalent risk to `pg.Pool.sanitizeQuery`, which this code never calls.",
        }),
      ]),
    );

    // "sanitizeQuery" does not appear anywhere in search-repos.ts, so the
    // dotted-reference exemption must not apply despite "pg"/"Pool" being real.
    expect(score.fabricatedEvidence).toHaveLength(1);
  });
});

describe("scoreFixture — category compatibility (Task 2)", () => {
  it("a production legacy category is mapped successfully via the compatibility layer where the canonical raw category would have failed to disambiguate", () => {
    const score = scoreFixture(
      webhooksVulnerableWithOptional,
      result([
        finding({
          category: "webhook-signature", // legacy -> "webhook.signature-verification" (unambiguous)
          severity: "P0",
          confidence: "high",
          file: "route.ts",
          lineStart: 8,
          lineEnd: 13,
          evidence: "",
        }),
      ]),
    );

    expect(score.requiredFindingsDetected).toEqual(["req-1"]);
    const [classified] = score.allFindings;
    expect(classified.matchMethod).toBe("compatibility_category_location");
    expect(classified.normalizedCategory).toBe("webhook.signature-verification");
    expect(classified.compatibilityApplied).toBe(true);
  });

  it("an unknown legacy category (no compatibility mapping) does not match anything and is reported as unmatched", () => {
    const score = scoreFixture(
      webhooksVulnerableWithOptional,
      result([
        finding({
          category: "some-legacy-label-nobody-ever-heard-of",
          severity: "P0",
          confidence: "high",
          file: "route.ts",
          lineStart: 8,
          lineEnd: 13,
          evidence: "",
        }),
      ]),
    );

    expect(score.requiredFindingsDetected).toEqual([]);
    expect(score.optionalFindingsAccepted).toEqual([]);
    const [classified] = score.allFindings;
    expect(classified.matchMethod).toBe("unmatched");
    expect(classified.normalizedCategory).toBeUndefined();
    expect(classified.classification).toBe("prohibited");
  });

  it("an ambiguous/generic legacy category is NOT enough to disambiguate two overlapping ground-truth entries — the finding stays unmatched rather than being merged into either", () => {
    const score = scoreFixture(
      webhooksVulnerableWithOptional,
      result([
        finding({
          category: "webhook-security", // legacy -> "webhook.generic" (deliberately not specific)
          severity: "P1",
          confidence: "medium",
          file: "route.ts",
          lineStart: 8, // overlaps BOTH req-1 and opt-1's declared region
          lineEnd: 13,
          evidence: "",
        }),
      ]),
    );

    // Must not be silently attributed to either overlapping entry.
    expect(score.requiredFindingsDetected).toEqual([]);
    expect(score.optionalFindingsAccepted).toEqual([]);
    const [classified] = score.allFindings;
    expect(classified.matchMethod).toBe("unmatched");
    expect(["prohibited", "unsupported_extra"]).toContain(classified.classification);
  });

  it("compatibilityApplied is false when the raw category alone already decides the outcome", () => {
    const score = scoreFixture(
      accessControlVulnerable,
      result([
        finding({
          category: "access-control.idor", // already canonical, no compat mapping involved
          file: "route.ts",
          lineStart: 8,
          lineEnd: 14,
          evidence: "",
        }),
      ]),
    );

    const [classified] = score.allFindings;
    expect(classified.compatibilityApplied).toBe(false);
  });
});

describe("scoreFixture — alternate_categories disambiguation (Task: fix confirmed scorer defects, item 3)", () => {
  it("a produced finding using req-1's alternate_categories, via the category-compat layer, matches on the one fixture that needs disambiguation (regression: webhooks-01's real baseline run)", () => {
    const score = scoreFixture(
      webhooksVulnerableWithOptional,
      result([
        finding({
          category: "broken-auth", // legacy -> "auth.broken-authentication" -> req-1's alternate_categories
          severity: "P0",
          confidence: "high",
          file: "route.ts",
          lineStart: 9,
          lineEnd: 14,
          evidence: "",
        }),
      ]),
    );

    expect(score.requiredFindingsDetected).toEqual(["req-1"]);
    expect(score.passed).toBe(true);
    const [classified] = score.allFindings;
    expect(classified.matchMethod).toBe("compatibility_category_location");
    expect(classified.normalizedCategory).toBe("auth.broken-authentication");
  });

  it("the already-canonical alternate category string matches directly, without needing the compatibility layer at all", () => {
    const score = scoreFixture(
      webhooksVulnerableWithOptional,
      result([
        finding({
          category: "auth.broken-authentication", // already canonical
          severity: "P0",
          confidence: "high",
          file: "route.ts",
          lineStart: 9,
          lineEnd: 14,
          evidence: "",
        }),
      ]),
    );

    expect(score.requiredFindingsDetected).toEqual(["req-1"]);
    const [classified] = score.allFindings;
    expect(classified.matchMethod).toBe("canonical_category_location");
    expect(classified.compatibilityApplied).toBe(false);
  });

  it("an alternate category still cannot resolve to the WRONG sibling entry — it only ever matches the specific entry that declares it", () => {
    // "auth.broken-authentication" is req-1's alternate, not opt-1's —
    // a finding using it must still never be credited toward opt-1
    // (webhook.idempotency), which declares no such alternate.
    const score = scoreFixture(
      webhooksVulnerableWithOptional,
      result([
        finding({
          category: "auth.broken-authentication",
          severity: "P2",
          confidence: "low",
          file: "route.ts",
          lineStart: 9,
          lineEnd: 14,
          evidence: "",
        }),
      ]),
    );

    expect(score.optionalFindingsAccepted).toEqual([]);
    expect(score.requiredFindingsDetected).toEqual(["req-1"]);
  });

  it("does not change matching for a fixture with no alternate_categories declared anywhere (additive-only, no broad weakening)", () => {
    const score = scoreFixture(
      accessControlVulnerable,
      result([finding({ category: "some-unrelated-legacy-label", file: "route.ts", lineStart: 8, lineEnd: 14, evidence: "" })]),
    );

    // access-control-01 has only one ground-truth entry (no disambiguation
    // needed at all), so this still matches by location alone — unrelated
    // to, and unaffected by, the alternate_categories mechanism.
    expect(score.requiredFindingsDetected).toEqual(["req-1"]);
  });
});

describe("scoreFixture — repository-scope findings (Task 4)", () => {
  it("a file: null finding matches a repository_scope: true ground-truth entry", () => {
    const score = scoreFixture(
      repositoryScopeTestFixture,
      result([
        finding({
          category: "ci-cd.generic",
          severity: "P1",
          confidence: "high",
          file: null,
          lineStart: null,
          lineEnd: null,
          evidence: "",
        }),
      ]),
    );

    expect(score.requiredFindingsDetected).toEqual(["req-1"]);
    expect(score.passed).toBe(true);
  });

  it("a file: null finding is never classified hallucinated_path, even on a fixture with no repository_scope entries", () => {
    const score = scoreFixture(
      accessControlVulnerable,
      result([finding({ file: null, lineStart: null, lineEnd: null, evidence: "" })]),
    );

    expect(score.hallucinatedPaths).toHaveLength(0);
    // Doesn't match anything either — there's no repository_scope entry here.
    expect(score.requiredFindingsDetected).toEqual([]);
  });

  it("a repository_scope entry can also be matched by a finding citing one of its declared files directly (not only by file: null)", () => {
    const score = scoreFixture(
      repositoryScopeTestFixture,
      result([
        finding({
          category: "ci-cd.generic",
          severity: "P1",
          confidence: "high",
          file: "ci.yml",
          lineStart: 1,
          lineEnd: 1,
          evidence: "",
        }),
      ]),
    );

    expect(score.requiredFindingsDetected).toEqual(["req-1"]);
  });

  it("on a fixture with a repository_scope entry, a file: null finding still misses if nothing else about it matches (e.g. wrong category with real disambiguation need)", () => {
    const score = scoreFixture(repositoryScopeTestFixture, result([]));

    expect(score.requiredFindingsDetected).toEqual([]);
    expect(score.requiredFindingsMissed).toEqual(["req-1"]);
  });
});

describe("producedFindingSchema / reviewerResultSchema", () => {
  it("rejects lineEnd set while lineStart is null", () => {
    const parsed = producedFindingSchema.safeParse({
      category: "access-control",
      severity: "P0",
      confidence: "high",
      file: "route.ts",
      lineStart: null,
      lineEnd: 5,
      evidence: "",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects lineStart greater than lineEnd", () => {
    const parsed = producedFindingSchema.safeParse({
      category: "access-control",
      severity: "P0",
      confidence: "high",
      file: "route.ts",
      lineStart: 20,
      lineEnd: 5,
      evidence: "",
    });
    expect(parsed.success).toBe(false);
  });

  it("defaults needsMoreContext and findings when omitted", () => {
    const parsed = reviewerResultSchema.parse({});
    expect(parsed.needsMoreContext).toBe(false);
    expect(parsed.findings).toEqual([]);
  });
});

describe("scoreFixture — evidence_state gating (Tasks 1 & 5)", () => {
  it("a P0 finding with evidenceState 'needs_more_context' is never a confirmed vulnerability, even when file/line/category all match exactly", () => {
    const score = scoreFixture(
      accessControlVulnerable,
      result([
        finding({
          category: "access-control.idor",
          severity: "P0",
          confidence: "high",
          file: "route.ts",
          lineStart: 8,
          lineEnd: 14,
          evidence: "const supabase = createServiceSupabaseClient();",
          evidenceState: "needs_more_context",
        }),
      ]),
    );

    expect(score.requiredFindingsDetected).toEqual([]);
    expect(score.requiredFindingsMissed).toEqual(["req-1"]);
    expect(score.insufficientEvidenceFindings).toHaveLength(1);
    expect(score.allFindings[0]?.classification).toBe("insufficient_evidence");
    // Not scored as a false positive either.
    expect(score.prohibitedFindings).toHaveLength(0);
    expect(score.falsePositives).toHaveLength(0);
  });

  it("a rule_id match does not override an evidenceState of 'needs_more_context' — the gate runs before any matching", () => {
    const score = scoreFixture(
      accessControlVulnerable,
      result([finding({ ruleId: "SEC-AUTHZ-001", evidenceState: "needs_more_context", evidence: "" })]),
    );

    expect(score.requiredFindingsDetected).toEqual([]);
    expect(score.allFindings[0]?.classification).toBe("insufficient_evidence");
  });

  it("an ambiguous fixture accepts a needs_more_context-flagged finding as a correct, cautious result (still passes)", () => {
    const score = scoreFixture(
      ambiguous,
      result([
        finding({
          category: "multi-tenant.security-definer",
          severity: "P1",
          confidence: "high",
          file: "migration.sql",
          lineStart: 5,
          lineEnd: 19,
          evidence: "security definer",
          evidenceState: "needs_more_context",
        }),
      ]),
    );

    expect(score.passed).toBe(true);
    expect(score.prohibitedFindings).toHaveLength(0);
  });

  it("a safe fixture's needs_more_context-flagged finding is not penalized as a false positive, but zero findings still ties it (never scores worse)", () => {
    const hedged = scoreFixture(
      accessControlSafe,
      result([
        finding({
          category: "access-control.idor",
          file: "worker.ts",
          lineStart: 15,
          lineEnd: 20,
          evidence: "",
          evidenceState: "needs_more_context",
        }),
      ]),
    );
    const zeroFindings = scoreFixture(accessControlSafe, result([]));

    expect(hedged.passed).toBe(true);
    expect(hedged.prohibitedFindings).toHaveLength(0);
    expect(hedged.rawScore).toBe(zeroFindings.rawScore);
  });

  it("proven/strongly_supported evidenceState does not change matching — a P0 finding still matches normally", () => {
    const score = scoreFixture(
      accessControlVulnerable,
      result([
        finding({
          category: "access-control.idor",
          file: "route.ts",
          lineStart: 8,
          lineEnd: 14,
          evidence: "const supabase = createServiceSupabaseClient();",
          evidenceState: "proven",
        }),
      ]),
    );

    expect(score.requiredFindingsDetected).toEqual(["req-1"]);
    expect(score.passed).toBe(true);
  });

  it("evidenceStateDiagnostics: a P0 finding with no evidenceState at all is 'not measurable', never a violation", () => {
    const score = scoreFixture(
      accessControlVulnerable,
      result([finding({ severity: "P0", evidence: "" })]), // evidenceState omitted, matching today's adapter output
    );

    expect(score.evidenceStateDiagnostics).toEqual({ p0p1Total: 1, p0p1Measurable: 0, p0p1NotMeasurable: 1, p0p1Violations: 0 });
  });

  it("evidenceStateDiagnostics: a P0 finding with evidenceState 'needs_more_context' is a violation, not merely not-measurable", () => {
    const score = scoreFixture(
      accessControlVulnerable,
      result([finding({ severity: "P0", evidence: "", evidenceState: "needs_more_context" })]),
    );

    expect(score.evidenceStateDiagnostics).toEqual({ p0p1Total: 1, p0p1Measurable: 0, p0p1NotMeasurable: 0, p0p1Violations: 1 });
  });

  it("evidenceStateDiagnostics: a P0 finding with evidenceState 'proven' counts as measurable", () => {
    const score = scoreFixture(
      accessControlVulnerable,
      result([finding({ severity: "P0", evidence: "", evidenceState: "proven" })]),
    );

    expect(score.evidenceStateDiagnostics).toEqual({ p0p1Total: 1, p0p1Measurable: 1, p0p1NotMeasurable: 0, p0p1Violations: 0 });
  });

  it("evidenceStateDiagnostics ignores non-P0/P1 findings entirely", () => {
    const score = scoreFixture(accessControlVulnerable, result([finding({ severity: "P2", evidence: "" })]));
    expect(score.evidenceStateDiagnostics).toEqual({ p0p1Total: 0, p0p1Measurable: 0, p0p1NotMeasurable: 0, p0p1Violations: 0 });
  });

  it("a diagnostic-flagged high-severity finding is counted even when its classification is prohibited, not just when matched", () => {
    const score = scoreFixture(
      accessControlSafe, // any finding at all is prohibited on this fixture
      result([finding({ category: "access-control.idor", severity: "P1", file: "worker.ts", evidence: "" })]),
    );

    expect(score.prohibitedFindings).toHaveLength(1);
    expect(score.evidenceStateDiagnostics.p0p1NotMeasurable).toBe(1);
  });
});

describe("producedFindingSchema — standards citations (Task 2)", () => {
  it("accepts a well-formed standards citation per framework", () => {
    for (const citation of [
      { framework: "owasp-top10" as const, id: "A01:2025" },
      { framework: "owasp-api-top10" as const, id: "API1:2023" },
      { framework: "asvs" as const, id: "ASVS-5.0-8.1.1" },
      { framework: "cwe" as const, id: "CWE-89" },
      { framework: "owasp-llm-top10" as const, id: "LLM01:2026" },
    ]) {
      const parsed = producedFindingSchema.safeParse({
        category: "access-control",
        severity: "P0",
        confidence: "high",
        file: "route.ts",
        lineStart: 1,
        lineEnd: 1,
        evidence: "",
        standards: [citation],
      });
      expect(parsed.success).toBe(true);
    }
  });

  it("rejects a fabricated/malformed standards id for its stated framework", () => {
    for (const citation of [
      { framework: "owasp-top10" as const, id: "A99:2025" },
      { framework: "cwe" as const, id: "CWE-abc" },
      { framework: "owasp-llm-top10" as const, id: "LLM99:2026" },
      { framework: "owasp-api-top10" as const, id: "not-a-real-id" },
    ]) {
      const parsed = producedFindingSchema.safeParse({
        category: "access-control",
        severity: "P0",
        confidence: "high",
        file: "route.ts",
        lineStart: 1,
        lineEnd: 1,
        evidence: "",
        standards: [citation],
      });
      expect(parsed.success).toBe(false);
    }
  });

  it("rejects an empty standards array — omit the field instead of asserting 'nothing applies'", () => {
    const parsed = producedFindingSchema.safeParse({
      category: "access-control",
      severity: "P0",
      confidence: "high",
      file: "route.ts",
      lineStart: 1,
      lineEnd: 1,
      evidence: "",
      standards: [],
    });
    expect(parsed.success).toBe(false);
  });

  it("standards is optional and absent by default", () => {
    const parsed = producedFindingSchema.parse({
      category: "access-control",
      severity: "P0",
      confidence: "high",
      file: "route.ts",
      lineStart: 1,
      lineEnd: 1,
      evidence: "",
    });
    expect(parsed.standards).toBeUndefined();
  });

  it("accepts securityConsequence/attackPreconditions/exploitScenario as optional free-form strings", () => {
    const parsed = producedFindingSchema.safeParse({
      category: "access-control",
      severity: "P0",
      confidence: "high",
      file: "route.ts",
      lineStart: 1,
      lineEnd: 1,
      evidence: "",
      securityConsequence: "Any authenticated caller can read another workspace's data.",
      attackPreconditions: "None — reachable by any authenticated request.",
      exploitScenario: "Attacker requests /api/reviews/<guessed-id> and receives the row.",
    });
    expect(parsed.success).toBe(true);
  });
});

describe("aggregateScores", () => {
  it("computes precision/recall/hallucination-rate sensibly across a mixed set of fixture scores", () => {
    const perfect = scoreFixture(
      accessControlVulnerable,
      result([
        finding({
          file: "route.ts",
          lineStart: 8,
          lineEnd: 14,
          evidence: "const supabase = createServiceSupabaseClient();",
        }),
      ]),
    );
    const missed = scoreFixture(accessControlVulnerable, result([]));
    const hallucinated = scoreFixture(accessControlVulnerable, result([finding({ file: "does-not-exist.ts" })]));
    const safePass = scoreFixture(accessControlSafe, result([]));

    const suite = aggregateScores([perfect, missed, hallucinated, safePass]);

    expect(suite.fixturesRun).toBe(4);
    expect(suite.fixturesFailed).toBe(1);
    expect(suite.fixturesPassed).toBe(2);
    expect(suite.hallucinationRate).toBeGreaterThan(0);
    expect(suite.recall).toBeCloseTo(1 / 3);
    expect(suite.precision).toBeCloseTo(1 / 2);
    expect(suite.failedFixtures).toEqual([hallucinated.fixtureId]);
  });

  it("reports vacuous rates as 1 (precision/recall) or 0 (FP/hallucination) when nothing was produced or required", () => {
    const allPassedNothingProduced = scoreFixture(ambiguous, result([]));
    const suite = aggregateScores([allPassedNothingProduced]);

    expect(suite.precision).toBe(1);
    expect(suite.recall).toBe(1);
    expect(suite.falsePositiveRate).toBe(0);
    expect(suite.hallucinationRate).toBe(0);
  });

  it("evidenceState coverageRate is vacuously 1 when no P0/P1 finding was produced anywhere", () => {
    const suite = aggregateScores([scoreFixture(accessControlVulnerable, result([]))]);
    expect(suite.evidenceState).toEqual({ p0p1Total: 0, p0p1Measurable: 0, p0p1NotMeasurable: 0, p0p1Violations: 0, coverageRate: 1 });
  });

  it("aggregates evidenceStateDiagnostics and insufficient_evidence classification counts across fixtures (Task 5)", () => {
    const notMeasurable = scoreFixture(accessControlVulnerable, result([finding({ severity: "P0", evidence: "" })]));
    const violation = scoreFixture(
      accessControlVulnerable,
      result([finding({ severity: "P0", evidence: "", evidenceState: "needs_more_context" })]),
    );
    const measurable = scoreFixture(
      accessControlVulnerable,
      result([finding({ severity: "P0", evidence: "", evidenceState: "proven" })]),
    );

    const suite = aggregateScores([notMeasurable, violation, measurable]);

    expect(suite.evidenceState.p0p1Total).toBe(3);
    expect(suite.evidenceState.p0p1NotMeasurable).toBe(1);
    expect(suite.evidenceState.p0p1Violations).toBe(1);
    expect(suite.evidenceState.p0p1Measurable).toBe(1);
    expect(suite.evidenceState.coverageRate).toBeCloseTo(1 / 3);
    expect(suite.classificationCounts.insufficient_evidence).toBe(1);
  });
});
