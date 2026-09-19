import { describe, expect, it } from "vitest";
import type { ProviderFinding } from "@/domain/schemas";
import type { ReviewContext } from "../types";
import {
  dropNonSecurityCategories,
  mergeDuplicateFindings,
  normalizeCategoryLabel,
  normalizeSecurityOutput,
  reanchorFromSignatureLine,
  redactUnverifiableQuotes,
} from "./security-normalization";

function finding(overrides: Partial<ProviderFinding> = {}): ProviderFinding {
  return {
    severity: "P0",
    title: "Finding",
    description: "Some description.",
    filePath: "route.ts",
    lineStart: 8,
    lineEnd: 14,
    category: "access-control",
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

describe("dropNonSecurityCategories (unsupported category rejected)", () => {
  it("drops findings whose category is a known process/meta-commentary label", () => {
    const findings = [
      finding({ category: "code-review-process" }),
      finding({ category: "code-quality" }),
      finding({ category: "informational" }),
      finding({ category: "suspicious-content" }),
    ];
    expect(dropNonSecurityCategories(findings)).toEqual([]);
  });

  it("keeps a finding using a real, if unfamiliar, security-shaped category — never a broad allow-list rejection", () => {
    const findings = [finding({ category: "tenant-isolation" }), finding({ category: "race-condition" }), finding({ category: "webhook-security" })];
    expect(dropNonSecurityCategories(findings)).toHaveLength(3);
  });

  it("keeps everything when nothing matches the deny-list", () => {
    const findings = [finding({ category: "sql-injection" })];
    expect(dropNonSecurityCategories(findings)).toEqual(findings);
  });
});

describe("redactUnverifiableQuotes (evidence must reference real source text)", () => {
  const context = diffContext({ "route.ts": ["const supabase = createServiceSupabaseClient();", "return supabase.from('reviews').select('*');"] });

  it("leaves an accurate, verbatim-quoted claim untouched", () => {
    const f = finding({ description: "Uses `createServiceSupabaseClient()` with no ownership check." });
    expect(redactUnverifiableQuotes(f, context).description).toBe(f.description);
  });

  it("is case-insensitive — a re-cased but accurate quote is not redacted", () => {
    const f = finding({ description: "Calls `CREATESERVICESUPABASECLIENT()` directly." });
    expect(redactUnverifiableQuotes(f, context).description).toBe(f.description);
  });

  it("redacts a fabricated, code-shaped claim that does not appear anywhere in the diff", () => {
    const f = finding({ description: "The route checks `validateOwnership(session, data)` before returning." });
    const result = redactUnverifiableQuotes(f, context);
    expect(result.description).not.toContain("validateOwnership");
    expect(result.description).toContain("[unverified quote removed]");
  });

  it("keeps the finding itself even after redacting its quote — never drops a finding for one bad quote", () => {
    const f = finding({ description: "Calls `validateOwnership()` before returning the row." });
    const result = redactUnverifiableQuotes(f, context);
    expect(result.severity).toBe(f.severity);
    expect(result.category).toBe(f.category);
  });

  it("does not redact an illustrative example introduced with 'e.g.'", () => {
    const f = finding({ description: "An attacker could send a payload, e.g. `' OR '1'='1`, to bypass the check." });
    expect(redactUnverifiableQuotes(f, context).description).toBe(f.description);
  });

  it("does not redact a bare identifier/API reference with no code-statement punctuation, even if unverifiable", () => {
    const f = finding({ description: "This is similar to the risk in `some.other.module`." });
    expect(redactUnverifiableQuotes(f, context).description).toBe(f.description);
  });

  it("leaves a finding with no filePath (repository-scope) untouched", () => {
    const f = finding({ filePath: null, lineStart: null, lineEnd: null, description: "No `enableRls()` call anywhere in the migration." });
    expect(redactUnverifiableQuotes(f, context).description).toBe(f.description);
  });

  it("leaves a finding referencing a file not present in the diff untouched (nothing to verify against)", () => {
    const f = finding({ filePath: "other.ts", description: "Calls `doesNotExist()`." });
    expect(redactUnverifiableQuotes(f, context).description).toBe(f.description);
  });
});

describe("mergeDuplicateFindings (duplicate root causes merge to one finding)", () => {
  it("merges two findings with overlapping line ranges in the same file into one", () => {
    const findings = [
      finding({ severity: "P0", confidence: 0.9, lineStart: 8, lineEnd: 18, description: "Short one." }),
      finding({ severity: "P1", confidence: 0.7, lineStart: 7, lineEnd: 19, description: "A much longer, more detailed description of the same root cause." }),
    ];
    const merged = mergeDuplicateFindings(findings);
    expect(merged).toHaveLength(1);
  });

  it("the merged survivor keeps the group's highest severity and confidence, even if that came from a different finding than the longest description", () => {
    const findings = [
      finding({ severity: "P2", confidence: 0.5, lineStart: 8, lineEnd: 14, description: "A much longer, more detailed description of the same root cause." }),
      finding({ severity: "P0", confidence: 0.95, lineStart: 9, lineEnd: 13, description: "Short." }),
    ];
    const [merged] = mergeDuplicateFindings(findings);
    expect(merged.severity).toBe("P0");
    expect(merged.confidence).toBe(0.95);
    expect(merged.description).toContain("longer, more detailed");
  });

  it("does not merge findings in different files", () => {
    const findings = [finding({ filePath: "a.ts", lineStart: 1, lineEnd: 5 }), finding({ filePath: "b.ts", lineStart: 1, lineEnd: 5 })];
    expect(mergeDuplicateFindings(findings)).toHaveLength(2);
  });

  it("does not merge findings whose line ranges do not overlap, even in the same file", () => {
    const findings = [finding({ lineStart: 1, lineEnd: 5 }), finding({ lineStart: 20, lineEnd: 25 })];
    expect(mergeDuplicateFindings(findings)).toHaveLength(2);
  });

  it("merges three overlapping findings into exactly one (transitive/group merge, not just pairwise)", () => {
    const findings = [finding({ lineStart: 8, lineEnd: 12 }), finding({ lineStart: 11, lineEnd: 15 }), finding({ lineStart: 14, lineEnd: 18 })];
    expect(mergeDuplicateFindings(findings)).toHaveLength(1);
  });

  it("merges regardless of category label differences (the same root cause is often mislabeled inconsistently)", () => {
    const findings = [finding({ category: "broken-access-control", lineStart: 8, lineEnd: 14 }), finding({ category: "broken-authentication", lineStart: 9, lineEnd: 13 })];
    expect(mergeDuplicateFindings(findings)).toHaveLength(1);
  });

  it("passes a single finding through unchanged", () => {
    const f = finding();
    expect(mergeDuplicateFindings([f])).toEqual([f]);
  });

  it("passes an empty list through unchanged", () => {
    expect(mergeDuplicateFindings([])).toEqual([]);
  });
});

describe("normalizeSecurityOutput (full pipeline)", () => {
  const context = diffContext({ "route.ts": Array.from({ length: 20 }, (_, i) => `line ${i + 1} createServiceSupabaseClient();`) });

  it("drops junk categories, redacts unverifiable quotes, and merges duplicates together in one pass", () => {
    const output = normalizeSecurityOutput(
      {
        summary: "s",
        findings: [
          finding({ category: "access-control", lineStart: 8, lineEnd: 10, description: "Uses `createServiceSupabaseClient()`." }),
          finding({ category: "broken-auth", lineStart: 9, lineEnd: 11, description: "Also calls `notARealFunction()` here." }),
          finding({ category: "code-review-process", lineStart: 1, lineEnd: 1 }),
        ],
      },
      context,
    );

    expect(output.findings).toHaveLength(1);
    expect(output.findings[0]?.description).not.toContain("notARealFunction");
  });

  it("never increases the number of findings", () => {
    const raw = [finding({ lineStart: 1, lineEnd: 1 }), finding({ lineStart: 5, lineEnd: 5 })];
    const output = normalizeSecurityOutput({ summary: "s", findings: raw }, context);
    expect(output.findings.length).toBeLessThanOrEqual(raw.length);
  });

  it("preserves the summary field untouched", () => {
    const output = normalizeSecurityOutput({ summary: "original summary", findings: [] }, context);
    expect(output.summary).toBe("original summary");
  });
});

describe("normalizeCategoryLabel (webhook auth/signature categories normalize deterministically)", () => {
  it.each(["broken-auth", "broken-authentication", "webhook-security", "webhook-signature", "webhook-auth"])(
    "normalizes '%s' to the canonical 'broken-authentication' label",
    (raw) => {
      expect(normalizeCategoryLabel(finding({ category: raw })).category).toBe("broken-authentication");
    },
  );

  it("is idempotent — normalizing the already-canonical label is a no-op", () => {
    const f = finding({ category: "broken-authentication" });
    expect(normalizeCategoryLabel(f)).toEqual(f);
  });

  it("leaves an unrelated security category completely untouched", () => {
    const f = finding({ category: "sql-injection" });
    expect(normalizeCategoryLabel(f)).toEqual(f);
  });

  it("leaves every OTHER field on the finding unchanged", () => {
    const f = finding({ category: "webhook-security", severity: "P0", confidence: 0.8 });
    const normalized = normalizeCategoryLabel(f);
    expect(normalized.severity).toBe("P0");
    expect(normalized.confidence).toBe(0.8);
    expect(normalized.filePath).toBe(f.filePath);
  });
});

describe("reanchorFromSignatureLine (harmless signature line does not replace stronger nearby evidence)", () => {
  // Mirrors the real fixture that exposed this issue: a one-line async
  // function signature immediately followed by the actual vulnerable
  // statement, both containing the identifier the model quoted.
  const context = diffContext({
    "auto-fix.ts": [
      "import { anthropicClient } from \"@/server/review-engine/providers/anthropic-provider\";", // 1
      "", // 2
      "export async function autoFixPullRequest(diffText: string): Promise<void> {", // 3
      "  const prompt = `Review this PR diff and suggest a fix:\\n${diffText}\\n`;", // 4
      "  await anthropicClient.messages.create({ model: \"claude-opus-5\", messages: [{ role: \"user\", content: prompt }] });", // 5
      "}", // 6
    ],
  });

  it("re-anchors from a bare function-signature line to a later line the finding's own quoted evidence verifiably points to (regression: llm-ai-01's real baseline run cited the signature instead of the vulnerable concatenation)", () => {
    const f = finding({
      filePath: "auto-fix.ts",
      lineStart: 3,
      lineEnd: 3,
      description: "The `diffText` parameter is concatenated directly into the prompt with no sanitization.",
    });
    const result = reanchorFromSignatureLine(f, context);
    expect(result.lineStart).toBe(4);
    expect(result.lineEnd).toBe(4);
  });

  it("preserves an adjacent multi-line span as-is when it is NOT anchored to a bare signature line", () => {
    const f = finding({ filePath: "auto-fix.ts", lineStart: 4, lineEnd: 5, description: "The prompt is built here and sent to the model." });
    expect(reanchorFromSignatureLine(f, context)).toEqual(f);
  });

  it("does nothing when the cited line is signature-shaped but no quoted span matches any later line (never invents a location)", () => {
    const f = finding({ filePath: "auto-fix.ts", lineStart: 3, lineEnd: 3, description: "This function has no input validation at all." });
    expect(reanchorFromSignatureLine(f, context)).toEqual(f);
  });

  it("does nothing when there is no quoted span in the description at all", () => {
    const f = finding({ filePath: "auto-fix.ts", lineStart: 3, lineEnd: 3, description: "No backtick quotes here whatsoever." });
    expect(reanchorFromSignatureLine(f, context)).toEqual(f);
  });

  it("does nothing for a finding with no filePath or lineStart", () => {
    const f = finding({ filePath: null, lineStart: null, lineEnd: null, description: "Uses `diffText` unsafely." });
    expect(reanchorFromSignatureLine(f, context)).toEqual(f);
  });

  it("ignores a too-short quoted span to avoid coincidental matches", () => {
    const f = finding({ filePath: "auto-fix.ts", lineStart: 3, lineEnd: 3, description: "Calls `id` unsafely." });
    // "id" is only 2 characters — below MIN_REANCHOR_SPAN_LENGTH — so even
    // though "id" trivially appears on many lines, no re-anchor happens.
    expect(reanchorFromSignatureLine(f, context)).toEqual(f);
  });

  it("full pipeline: an adjacent vulnerable span found via re-anchoring survives normalization end-to-end and correctly merges with a finding already citing that same later line", () => {
    const output = normalizeSecurityOutput(
      {
        summary: "s",
        findings: [
          finding({
            filePath: "auto-fix.ts",
            lineStart: 3,
            lineEnd: 3,
            severity: "P1",
            description: "The `diffText` parameter is concatenated directly into the prompt with no sanitization.",
          }),
          finding({
            filePath: "auto-fix.ts",
            lineStart: 4,
            lineEnd: 4,
            severity: "P0",
            description: "Untrusted diff content reaches the LLM prompt with no delimiter.",
          }),
        ],
      },
      context,
    );

    // Both findings now point at line 4 (after re-anchoring the first) and
    // merge into one, keeping the group's highest severity.
    expect(output.findings).toHaveLength(1);
    expect(output.findings[0]?.lineStart).toBe(4);
    expect(output.findings[0]?.severity).toBe("P0");
  });
});

describe("causal-chain findings stay separate through the normalization pipeline", () => {
  it("two distinct, non-overlapping vulnerabilities in the same causal chain are never merged just because one is downstream of the other", () => {
    const context = diffContext({
      "auto-fix.ts": [
        "export async function autoFixPullRequest(diffText: string): Promise<void> {", // 1
        "  const prompt = `Fix this:\\n${diffText}`;", // 2
        "  const response = await anthropicClient.messages.create({ messages: [{ role: \"user\", content: prompt }] });", // 3
        "  const result = JSON.parse(response.content[0].text);", // 4
        "  await applyFileEdit(result.filePath, result.newContent);", // 5
        "}", // 6
      ],
    });

    const output = normalizeSecurityOutput(
      {
        summary: "s",
        findings: [
          finding({
            filePath: "auto-fix.ts",
            lineStart: 2,
            lineEnd: 2,
            category: "injection",
            description: "The `diffText` parameter is concatenated directly into the prompt with no delimiter — prompt injection.",
          }),
          finding({
            filePath: "auto-fix.ts",
            lineStart: 5,
            lineEnd: 5,
            category: "injection",
            description: "`applyFileEdit(result.filePath, result.newContent)` is called with no validation of the model's output — unsafe tool use.",
          }),
        ],
      },
      context,
    );

    expect(output.findings).toHaveLength(2);
  });
});
