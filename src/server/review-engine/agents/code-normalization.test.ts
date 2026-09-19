import { describe, expect, it } from "vitest";
import type { ProviderFinding } from "@/domain/schemas";
import type { ReviewContext } from "../types";
import {
  canonicalizeCategory,
  downgradeAcknowledgedUncertaintyConfidence,
  dropHypotheticalFutureConcerns,
  dropSecurityCategories,
  dropStandardSliceNegativeIndexConcerns,
  dropUnreachableExhaustiveSwitchConcerns,
  mergeDuplicateFindings,
  normalizeCodeOutput,
  redactUnverifiableQuotes,
} from "./code-normalization";

function finding(overrides: Partial<ProviderFinding> = {}): ProviderFinding {
  return {
    severity: "P1",
    title: "Finding",
    description: "Some description.",
    filePath: "paginate.ts",
    lineStart: 7,
    lineEnd: 7,
    category: "correctness",
    recommendation: "Fix it.",
    confidence: 0.9,
    ...overrides,
  };
}

function diffContext(fileContents: Record<string, string[]>): ReviewContext {
  const diffText = Object.entries(fileContents)
    .map(([path, lines]) => [`diff --git a/${path} b/${path}`, "new file mode 100644", "--- /dev/null", `+++ b/${path}`, `@@ -0,0 +1,${lines.length} @@`, ...lines.map((l) => `+${l}`)].join("\n"))
    .join("\n");
  return {
    pullRequestTitle: "PR",
    sourceBranch: "feature",
    targetBranch: "main",
    changedFiles: Object.keys(fileContents).map((path) => ({ path, status: "added", additions: fileContents[path].length, deletions: 0 })),
    diffText,
    diffTruncated: false,
    changedFilesTruncated: false,
  };
}

describe("dropSecurityCategories (reviewer lane discipline)", () => {
  it("drops findings using a security-oriented category, leaving the Security Reviewer's lane alone", () => {
    const findings = [
      finding({ category: "security" }),
      finding({ category: "injection" }),
      finding({ category: "xss" }),
      finding({ category: "authentication" }),
      finding({ category: "access-control" }),
    ];
    expect(dropSecurityCategories(findings)).toEqual([]);
  });

  it("is case-insensitive", () => {
    expect(dropSecurityCategories([finding({ category: "Security" })])).toEqual([]);
  });

  it("keeps genuine code-reviewer categories untouched", () => {
    const findings = [finding({ category: "correctness" }), finding({ category: "performance" }), finding({ category: "concurrency" }), finding({ category: "maintainability" })];
    expect(dropSecurityCategories(findings)).toEqual(findings);
  });
});

describe("dropHypotheticalFutureConcerns (current-code-only discipline)", () => {
  it("drops a finding built on a future source change rather than the current code's behavior", () => {
    const findings = [
      finding({
        description:
          "If this function is called with a value not in the union (e.g. from untyped/JS code, a type assertion, an API response, or after a new status is added to ReviewStatus without updating this switch), it will return undefined.",
      }),
    ];
    expect(dropHypotheticalFutureConcerns(findings)).toEqual([]);
  });

  it("drops a finding phrased around a union/enum being extended later", () => {
    expect(dropHypotheticalFutureConcerns([finding({ description: "If this enum is extended, this switch will silently fall through and return undefined." })])).toEqual([]);
  });

  it("does NOT drop a legitimate current-code maintainability finding that merely mentions 'a future change' as the reason duplication is risky", () => {
    const findings = [
      finding({
        category: "maintainability",
        description:
          "This duplication means any change to the threshold has to be replicated in four places, increasing the risk that a future change to one branch isn't applied consistently to the other three.",
      }),
    ];
    expect(dropHypotheticalFutureConcerns(findings)).toEqual(findings);
  });

  it("keeps a finding about the current code's behavior on an input it can already receive today", () => {
    const findings = [finding({ description: "If scores is an empty array, reduce() throws a TypeError because no initial value is provided." })];
    expect(dropHypotheticalFutureConcerns(findings)).toEqual(findings);
  });

  it("keeps a finding describing a current runtime edge case that happens to use conditional phrasing", () => {
    const findings = [finding({ description: "If lookupDiscount throws, the exception propagates uncaught from applyDiscountCode." })];
    expect(dropHypotheticalFutureConcerns(findings)).toEqual(findings);
  });
});

describe("downgradeAcknowledgedUncertaintyConfidence (ambiguity/confidence calibration)", () => {
  it("caps confidence to low when the description admits the behavior depends on something unseen", () => {
    const f = finding({ confidence: 0.7, description: "lookupDiscount may return undefined, null, or throw, depending on its own implementation." });
    expect(downgradeAcknowledgedUncertaintyConfidence(f).confidence).toBeLessThan(0.5);
  });

  it("caps confidence to low for 'under the hood' hedging language", () => {
    const f = finding({ confidence: 0.9, description: "This could fail if the dependency is async under the hood." });
    expect(downgradeAcknowledgedUncertaintyConfidence(f).confidence).toBeLessThan(0.5);
  });

  it("caps confidence to low for passive-voice hedging ('cannot be confirmed', 'not shown in the diff')", () => {
    const f = finding({
      confidence: 0.5,
      description: "Since discounts.ts is not shown in the diff, the exact contract of lookupDiscount cannot be confirmed, but the current code performs no defensive checks.",
    });
    expect(downgradeAcknowledgedUncertaintyConfidence(f).confidence).toBeLessThan(0.5);
  });

  it("never RAISES confidence — a finding already below the cap is left untouched", () => {
    const f = finding({ confidence: 0.1, description: "Depending on the implementation, this may or may not throw." });
    expect(downgradeAcknowledgedUncertaintyConfidence(f).confidence).toBe(0.1);
  });

  it("leaves a confidently and concretely demonstrated finding's confidence untouched", () => {
    const f = finding({ confidence: 0.9, description: "scores.reduce((sum, score) => sum + score) throws when scores is empty because no initial value is supplied." });
    expect(downgradeAcknowledgedUncertaintyConfidence(f).confidence).toBe(0.9);
  });

  it("preserves every other field on the finding", () => {
    const f = finding({ confidence: 0.9, severity: "P0", description: "May return undefined or throw depending on lookupDiscount's own contract." });
    const result = downgradeAcknowledgedUncertaintyConfidence(f);
    expect(result.severity).toBe("P0");
    expect(result.category).toBe(f.category);
    expect(result.filePath).toBe(f.filePath);
  });
});

describe("redactUnverifiableQuotes (evidence precision: literal source text only)", () => {
  const context = diffContext({
    "paginate.ts": [
      "export function getPage(items, pageNumber, pageSize) {",
      "  const start = (pageNumber - 1) * pageSize;",
      "  const end = start + pageSize;",
      "  return items.slice(start, end + 1);",
      "}",
    ],
  });

  it("literal-evidence enforcement: redacts a computed/derived value that never appears as that literal string in source", () => {
    const f = finding({
      description: "Calls `items.slice(start, end + 1)`, which returns `pageSize + 1` items instead of `pageSize` items.",
    });
    const result = redactUnverifiableQuotes(f, context);
    expect(result.description).toContain("items.slice(start, end + 1)");
    expect(result.description).not.toContain("`pageSize + 1`");
    expect(result.description).toContain("[unverified quote removed]");
  });

  it("no ellipsis-as-verbatim: redacts an ellipsis-abbreviated stand-in for a call with different real arguments", () => {
    const source = diffContext({ "status-color.ts": ['  console.log(`resolved status color for ${status}`);'] });
    const f = finding({ filePath: "status-color.ts", description: "The subsequent `console.log(...)` statement is unreachable dead code." });
    const result = redactUnverifiableQuotes(f, source);
    expect(result.description).not.toContain("console.log(...)");
    expect(result.description).toContain("[unverified quote removed]");
  });

  it("leaves an exact, verbatim quote untouched", () => {
    const f = finding({ description: "Calls `items.slice(start, end + 1)` which is inclusive of `end`." });
    expect(redactUnverifiableQuotes(f, context).description).toBe(f.description);
  });

  it("never drops the finding itself for one bad quote", () => {
    const f = finding({ description: "Returns `pageSize + 1` items per page." });
    const result = redactUnverifiableQuotes(f, context);
    expect(result.severity).toBe(f.severity);
    expect(result.category).toBe(f.category);
  });

  it("does not redact an illustrative example introduced with 'e.g.'", () => {
    const f = finding({ description: "A malformed input, e.g. `not-a-number`, is never validated." });
    expect(redactUnverifiableQuotes(f, context).description).toBe(f.description);
  });
});

describe("dropUnreachableExhaustiveSwitchConcerns (exhaustive typed switch)", () => {
  it("exhaustive typed switch should not produce a missing-default finding when only speculative reachability is offered", () => {
    const findings = [
      finding({
        category: "correctness",
        description:
          "The switch statement covers all current values of the ReviewStatus union and TypeScript's exhaustiveness checking accepts it with no default case. If this function is ever invoked with a status value obtained from an untyped or external source (e.g., parsed JSON, a database field, or an API response) that doesn't strictly conform to the ReviewStatus type at runtime, it will implicitly return undefined.",
      }),
    ];
    expect(dropUnreachableExhaustiveSwitchConcerns(findings)).toEqual([]);
  });

  it("keeps a finding about a switch that is NOT admitted to be exhaustive", () => {
    const findings = [finding({ description: "This switch is missing a case for the 'archived' status and will fall through silently." })];
    expect(dropUnreachableExhaustiveSwitchConcerns(findings)).toEqual(findings);
  });

  it("keeps an exhaustiveness-admitting finding when it cites a concrete call site in the same diff instead of speculating", () => {
    const findings = [
      finding({
        description:
          "The switch is exhaustive over ReviewStatus, but route.ts line 42 (added in this diff) calls statusLabel(req.query.status as ReviewStatus) with an unvalidated query parameter, so an invalid value reaches this switch on every malformed request.",
      }),
    ];
    expect(dropUnreachableExhaustiveSwitchConcerns(findings)).toEqual(findings);
  });
});

describe("dropStandardSliceNegativeIndexConcerns (thin-wrapper/stdlib semantics)", () => {
  it("standard Array.prototype.slice negative-index semantics should not be treated as a defect by default", () => {
    const findings = [
      finding({
        category: "correctness",
        description:
          "getRange is a thin wrapper around Array.prototype.slice. Native slice() treats negative indices as offsets from the end of the array, which is inconsistent with a literal half-open range interpretation implied by the function's docstring.",
      }),
    ];
    expect(dropStandardSliceNegativeIndexConcerns(findings)).toEqual([]);
  });

  it("keeps an unrelated stdlib-based finding — a missing reduce() initial value is a real current-input crash risk, not a documented-behavior complaint", () => {
    const findings = [
      finding({
        description: "totalReviewScore calls scores.reduce((sum, score) => sum + score) without an initial value; Array.prototype.reduce throws on an empty array.",
      }),
    ];
    expect(dropStandardSliceNegativeIndexConcerns(findings)).toEqual(findings);
  });

  it("keeps a slice-based finding that does not frame the stdlib behavior itself as the defect", () => {
    const findings = [finding({ description: "items.slice(start, end + 1) is inclusive of end, returning one extra item per page." })];
    expect(dropStandardSliceNegativeIndexConcerns(findings)).toEqual(findings);
  });
});

describe("canonicalizeCategory (category specificity)", () => {
  it("category normalization chooses canonical specific labels: correctness -> correctness.off-by-one", () => {
    const f = finding({ category: "correctness", description: "The slice call is inclusive of end, returning one extra item beyond the intended page size — a classic off-by-one." });
    expect(canonicalizeCategory(f).category).toBe("correctness.off-by-one");
  });

  it("maintainability -> dead-code.unreachable", () => {
    const f = finding({ category: "maintainability", description: "The console.log statement after the if/else return block is unreachable and will never execute." });
    expect(canonicalizeCategory(f).category).toBe("dead-code.unreachable");
  });

  it("correctness -> concurrency.missing-await", () => {
    const f = finding({ category: "correctness", description: "subscriberIds.forEach(async (id) => ...) does not await the notifications, so the function resolves before they complete." });
    expect(canonicalizeCategory(f).category).toBe("concurrency.missing-await");
  });

  it("error-handling -> error-handling.swallowed-exception", () => {
    const f = finding({ category: "error-handling", description: "The catch block only logs a static string and swallows the actual error, never rethrowing it." });
    expect(canonicalizeCategory(f).category).toBe("error-handling.swallowed-exception");
  });

  it("performance -> performance.algorithmic-complexity", () => {
    const f = finding({ category: "performance", description: "blockedUserIds.includes(id) inside the filter callback performs a linear scan for every comment, an O(n*m) nested loop." });
    expect(canonicalizeCategory(f).category).toBe("performance.algorithmic-complexity");
  });

  it("maintainability -> maintainability.duplication", () => {
    const f = finding({ category: "maintainability", description: "The same total > 1000 check and label pattern is duplicated four times across the branches." });
    expect(canonicalizeCategory(f).category).toBe("maintainability.duplication");
  });

  it("maintainability -> maintainability.complexity", () => {
    const f = finding({ category: "maintainability", description: "The function nests four levels of if/else, adding significant cognitive complexity." });
    expect(canonicalizeCategory(f).category).toBe("maintainability.complexity");
  });

  it("never reclassifies into an unrelated domain — a performance finding mentioning '+1' is not turned into correctness.off-by-one", () => {
    const f = finding({ category: "performance", description: "This adds one extra O(n) pass; consider caching the +1 offset." });
    expect(canonicalizeCategory(f).category).toBe("performance");
  });

  it("leaves a category untouched when no rule's description signature matches", () => {
    const f = finding({ category: "correctness", description: "Something is subtly wrong here but it's hard to pin down exactly why." });
    expect(canonicalizeCategory(f)).toEqual(f);
  });

  it("leaves every other field on the finding unchanged", () => {
    const f = finding({ category: "correctness", severity: "P0", confidence: 0.8, description: "Off-by-one: end + 1 makes the slice inclusive of end." });
    const result = canonicalizeCategory(f);
    expect(result.severity).toBe("P0");
    expect(result.confidence).toBe(0.8);
    expect(result.filePath).toBe(f.filePath);
  });
});

describe("mergeDuplicateFindings (same-root-cause merge)", () => {
  it("same-root-cause merge: two findings restating the same overlapping defect from different angles merge into one", () => {
    const findings = [
      finding({
        lineStart: 7,
        lineEnd: 9,
        description: "forEach with an async callback does not await the notifications, so the function resolves before they complete.",
      }),
      finding({
        lineStart: 7,
        lineEnd: 9,
        category: "error-handling",
        description: "Because the async callback is never awaited, a rejection from sendNotification becomes an unhandled promise rejection.",
      }),
    ];
    expect(mergeDuplicateFindings(findings)).toHaveLength(1);
  });

  it("keeps genuinely distinct, non-overlapping root causes separate", () => {
    const findings = [
      finding({ lineStart: 7, lineEnd: 7, description: "Off-by-one in the slice end bound." }),
      finding({ lineStart: 1, lineEnd: 3, description: "pageNumber/pageSize are never validated." }),
    ];
    expect(mergeDuplicateFindings(findings)).toHaveLength(2);
  });

  it("merges transitively across three overlapping findings, not just pairwise", () => {
    const findings = [finding({ lineStart: 10, lineEnd: 20 }), finding({ lineStart: 19, lineEnd: 25 }), finding({ lineStart: 24, lineEnd: 30 })];
    expect(mergeDuplicateFindings(findings)).toHaveLength(1);
  });
});

describe("normalizeCodeOutput (full pipeline)", () => {
  const context = diffContext({
    "apply-discount.ts": [
      "export function applyDiscountCode(cart, code) {",
      "  const discount = lookupDiscount(code);",
      "  return { ...cart, total: cart.total - discount };",
      "}",
    ],
  });

  it("acknowledged uncertainty -> low confidence: an ambiguous, unconfirmed-dependency finding survives at low confidence rather than being asserted confidently", () => {
    const output = normalizeCodeOutput(
      {
        summary: "s",
        findings: [
          finding({
            filePath: "apply-discount.ts",
            lineStart: 2,
            lineEnd: 3,
            confidence: 0.6,
            description: "lookupDiscount may return undefined, null, or throw, resulting in cart.total becoming NaN.",
          }),
        ],
      },
      context,
    );
    expect(output.findings).toHaveLength(1);
    expect(output.findings[0]?.confidence).toBeLessThan(0.5);
  });

  it("security category excluded from Code Reviewer output end-to-end", () => {
    const output = normalizeCodeOutput(
      {
        summary: "s",
        findings: [finding({ category: "security", description: "The code parameter is passed without sanitization." })],
      },
      context,
    );
    expect(output.findings).toEqual([]);
  });

  it("hypothetical future concern omitted end-to-end", () => {
    const output = normalizeCodeOutput(
      {
        summary: "s",
        findings: [finding({ description: "This is fine today but will break in the future if a new discount type is added without updating this function." })],
      },
      context,
    );
    expect(output.findings).toEqual([]);
  });

  it("never increases the number of findings", () => {
    const raw = [finding({ lineStart: 1, lineEnd: 1 }), finding({ lineStart: 5, lineEnd: 5 })];
    const output = normalizeCodeOutput({ summary: "s", findings: raw }, context);
    expect(output.findings.length).toBeLessThanOrEqual(raw.length);
  });

  it("preserves the summary field untouched", () => {
    const output = normalizeCodeOutput({ summary: "original summary", findings: [] }, context);
    expect(output.summary).toBe("original summary");
  });

  it("exhaustive-switch concern omitted end-to-end", () => {
    const switchContext = diffContext({
      "status-label.ts": [
        "export function statusLabel(status: ReviewStatus): string {",
        "  switch (status) {",
        "    case 'pending': return 'Pending';",
        "    case 'approved': return 'Approved';",
        "  }",
        "}",
      ],
    });
    const output = normalizeCodeOutput(
      {
        summary: "s",
        findings: [
          finding({
            filePath: "status-label.ts",
            lineStart: 2,
            lineEnd: 5,
            description:
              "The switch covers all current ReviewStatus values and TypeScript's exhaustiveness checking accepts it with no default. If this function is ever invoked with a value from an untyped or external source, such as a database field or an API response, it will silently return undefined.",
          }),
        ],
      },
      switchContext,
    );
    expect(output.findings).toEqual([]);
  });

  it("standard slice negative-index concern omitted end-to-end", () => {
    const sliceContext = diffContext({
      "ranges.ts": ["export function getRange(items, startIndex, endIndexExclusive) {", "  return items.slice(startIndex, endIndexExclusive);", "}"],
    });
    const output = normalizeCodeOutput(
      {
        summary: "s",
        findings: [
          finding({
            filePath: "ranges.ts",
            lineStart: 1,
            lineEnd: 2,
            description: "getRange is a thin wrapper around Array.prototype.slice(). Negative indices are treated as offsets from the end, which is inconsistent with the docstring.",
          }),
        ],
      },
      sliceContext,
    );
    expect(output.findings).toEqual([]);
  });
});

describe("existing true positives still survive the full pipeline unchanged in substance", () => {
  const notifyContext = diffContext({
    "notify.ts": ["export async function notifyAllSubscribers(subscriberIds) {", "  subscriberIds.forEach(async (id) => { await sendNotification(id); });", "  console.log('all subscribers notified');", "}"],
  });

  it("a genuine missing-await finding survives, is not dropped, and is canonicalized to concurrency.missing-await", () => {
    const output = normalizeCodeOutput(
      {
        summary: "s",
        findings: [
          finding({
            category: "correctness",
            filePath: "notify.ts",
            lineStart: 2,
            lineEnd: 2,
            confidence: 0.9,
            description: "subscriberIds.forEach(async (id) => { await sendNotification(id); }) does not await the notifications, so the function resolves before they complete.",
          }),
        ],
      },
      notifyContext,
    );
    expect(output.findings).toHaveLength(1);
    expect(output.findings[0]?.category).toBe("concurrency.missing-await");
    expect(output.findings[0]?.confidence).toBe(0.9);
  });

  const scoreContext = diffContext({ "score.ts": ["export function totalReviewScore(scores) {", "  return scores.reduce((sum, score) => sum + score);", "}"] });

  it("a genuine reduce()-without-initial-value finding survives at full confidence (not caught by the slice-semantics filter)", () => {
    const output = normalizeCodeOutput(
      {
        summary: "s",
        findings: [
          finding({
            category: "error-handling",
            filePath: "score.ts",
            lineStart: 2,
            lineEnd: 2,
            confidence: 0.95,
            description: "totalReviewScore calls scores.reduce((sum, score) => sum + score) without an initial value; Array.prototype.reduce throws on an empty array.",
          }),
        ],
      },
      scoreContext,
    );
    expect(output.findings).toHaveLength(1);
    expect(output.findings[0]?.confidence).toBe(0.95);
  });

  const statusColorContext = diffContext({
    "status-color.ts": ["export function getStatusColor(status) {", "  if (status === 'open') { return \"green\"; } else { return \"gray\"; }", "  console.log(`resolved status color for ${status}`);", "}"],
  });

  it("a genuine dead-code finding survives and is canonicalized to dead-code.unreachable", () => {
    const output = normalizeCodeOutput(
      {
        summary: "s",
        findings: [
          finding({
            category: "maintainability",
            filePath: "status-color.ts",
            lineStart: 3,
            lineEnd: 3,
            description: "The console.log statement after the if/else return block is unreachable and will never execute.",
          }),
        ],
      },
      statusColorContext,
    );
    expect(output.findings).toHaveLength(1);
    expect(output.findings[0]?.category).toBe("dead-code.unreachable");
  });
});
