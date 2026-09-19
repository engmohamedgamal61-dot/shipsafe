import { describe, expect, it } from "vitest";
import type { ProviderFinding } from "@/domain/schemas";
import type { ReviewContext } from "../types";
import {
  canonicalizeCategory,
  capInflatedSeverity,
  downgradeUnclearContextConfidence,
  dropHypotheticalScaleConcerns,
  dropOutOfLaneFindings,
  mergeDuplicateFindings,
  normalizeArchitectureOutput,
  redactUnverifiableQuotes,
} from "./architecture-normalization";

function finding(overrides: Partial<ProviderFinding> = {}): ProviderFinding {
  return {
    severity: "P1",
    title: "Finding",
    description: "Some description.",
    filePath: "supabase-adapter.ts",
    lineStart: 2,
    lineEnd: 8,
    category: "architecture",
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

describe("dropOutOfLaneFindings (reviewer lane discipline)", () => {
  it("security finding is dropped from Architecture Reviewer, by category", () => {
    const findings = [finding({ category: "security" }), finding({ category: "access-control" }), finding({ category: "authorization" })];
    expect(dropOutOfLaneFindings(findings)).toEqual([]);
  });

  it("a security/access-control finding is dropped even under a generic category, by content", () => {
    const findings = [finding({ category: "security", description: "This action calls getReviewById with a privileged pseudo-user, bypassing the ownership check." })];
    expect(dropOutOfLaneFindings(findings)).toEqual([]);
  });

  it("missing-tests finding is dropped regardless of category", () => {
    const findings = [finding({ category: "testing", description: "This PR adds new exported functions but includes no unit tests." })];
    expect(dropOutOfLaneFindings(findings)).toEqual([]);
  });

  it("missing-try/catch finding is dropped regardless of category", () => {
    const findings = [finding({ category: "reliability", description: "repo.getReviewById is awaited without any try/catch, so an unhandled exception propagates." })];
    expect(dropOutOfLaneFindings(findings)).toEqual([]);
  });

  it("an ordinary correctness/stub-implementation finding is dropped", () => {
    const findings = [finding({ category: "maintainability", description: "The private fetchRows method is a placeholder that always returns an empty array, ignoring userId entirely." })];
    expect(dropOutOfLaneFindings(findings)).toEqual([]);
  });

  it("a database constraint finding is dropped", () => {
    const findings = [finding({ category: "architecture", description: "This new column has no foreign key constraint referencing the parent table." })];
    expect(dropOutOfLaneFindings(findings)).toEqual([]);
  });

  it("does NOT drop a legitimate duplication finding sharing the broad 'maintainability' category", () => {
    const findings = [
      finding({
        category: "maintainability",
        description: "Both release-judge.ts and dashboard-summary.ts independently define an identical SEVERITY_ORDER array rather than importing a shared definition.",
      }),
    ];
    expect(dropOutOfLaneFindings(findings)).toEqual(findings);
  });

  it("keeps genuine architectural categories untouched", () => {
    const findings = [finding({ category: "layer-boundaries.cross-layer-import" }), finding({ category: "coupling.bypasses-port-abstraction" })];
    expect(dropOutOfLaneFindings(findings)).toEqual(findings);
  });
});

describe("dropHypotheticalScaleConcerns (no hypothetical scale/future-risk invention)", () => {
  it("hypothetical scale concern omitted: unbounded-growth-over-time speculation on a TTL cache", () => {
    const findings = [
      finding({
        description: "The cache Map only evicts on access; entries for users who never return are never evicted. Over time and across many distinct userIds, this can cause unbounded memory growth.",
      }),
    ];
    expect(dropHypotheticalScaleConcerns(findings)).toEqual([]);
  });

  it("drops horizontal-scaling/multi-instance staleness speculation", () => {
    const findings = [finding({ description: "The decorator has no mechanism to stay coherent across multiple process instances (horizontal scaling), which may be surprising to callers." })];
    expect(dropHypotheticalScaleConcerns(findings)).toEqual([]);
  });

  it("keeps a finding about a CURRENT, concretely demonstrated coupling problem", () => {
    const findings = [finding({ description: "SupabaseReviewRepository directly imports and instantiates AnthropicProvider, coupling the persistence layer to a specific AI vendor." })];
    expect(dropHypotheticalScaleConcerns(findings)).toEqual(findings);
  });
});

describe("downgradeUnclearContextConfidence (ambiguity/confidence calibration)", () => {
  it("caps confidence to low when architectural ownership is acknowledged as unclear", () => {
    const f = finding({ confidence: 0.7, description: "This could be either a harmless constant or real domain policy, depending on how it's actually used elsewhere." });
    expect(downgradeUnclearContextConfidence(f).confidence).toBeLessThan(0.5);
  });

  it("caps confidence to low for 'cannot be confirmed' hedging", () => {
    const f = finding({ confidence: 0.9, description: "Without seeing its call sites, whether this is a real architectural misplacement cannot be confirmed." });
    expect(downgradeUnclearContextConfidence(f).confidence).toBeLessThan(0.5);
  });

  it("never raises confidence — a finding already below the cap is left untouched", () => {
    const f = finding({ confidence: 0.1, description: "Depending on usage, this may or may not be a real concern." });
    expect(downgradeUnclearContextConfidence(f).confidence).toBe(0.1);
  });

  it("leaves a confidently and concretely demonstrated finding's confidence untouched", () => {
    const f = finding({ confidence: 0.9, description: "SupabaseReviewRepository imports RepositoryCard from the UI layer and calls it directly inside listRepositoriesForUser." });
    expect(downgradeUnclearContextConfidence(f).confidence).toBe(0.9);
  });
});

describe("capInflatedSeverity (severity calibration)", () => {
  it("severity inflation prevented: an unjustified P0 is capped to P1", () => {
    const f = finding({ severity: "P0", description: "The repository imports a UI component, violating layer boundaries." });
    expect(capInflatedSeverity(f).severity).toBe("P1");
  });

  it("keeps P0 when the description itself states genuinely catastrophic impact", () => {
    const f = finding({ severity: "P0", description: "This ordering bug causes irreversible data loss during the migration." });
    expect(capInflatedSeverity(f).severity).toBe("P0");
  });

  it("never touches P1/P2/Nit", () => {
    expect(capInflatedSeverity(finding({ severity: "P1" })).severity).toBe("P1");
    expect(capInflatedSeverity(finding({ severity: "P2" })).severity).toBe("P2");
    expect(capInflatedSeverity(finding({ severity: "NIT" })).severity).toBe("NIT");
  });
});

describe("redactUnverifiableQuotes (evidence precision)", () => {
  const context = diffContext({
    "supabase-adapter.ts": ["export class SupabaseReviewRepository {", '  private readonly provider = new AnthropicProvider(process.env.ANTHROPIC_API_KEY ?? "");', "}"],
  });

  it("ellipsis quote redacted: an abbreviated constructor call is not treated as literal evidence", () => {
    const f = finding({ filePath: "supabase-adapter.ts", description: "Constructed inline as `new AnthropicProvider(...)` rather than injected." });
    const result = redactUnverifiableQuotes(f, context);
    expect(result.description).not.toContain("AnthropicProvider(...)");
    expect(result.description).toContain("[unverified quote removed]");
  });

  it("leaves an exact, verbatim quote untouched", () => {
    const f = finding({ filePath: "supabase-adapter.ts", description: "Declares `export class SupabaseReviewRepository {` at the top." });
    expect(redactUnverifiableQuotes(f, context).description).toBe(f.description);
  });

  it("never drops the finding itself for one bad quote", () => {
    const f = finding({ filePath: "supabase-adapter.ts", description: "Uses `new AnthropicProvider(...)` here." });
    const result = redactUnverifiableQuotes(f, context);
    expect(result.severity).toBe(f.severity);
    expect(result.category).toBe(f.category);
  });
});

describe("mergeDuplicateFindings (same architectural root cause merges to one finding)", () => {
  it("two findings restating the same layer-boundary violation from different angles merge into one", () => {
    const findings = [
      finding({ lineStart: 1, lineEnd: 8, description: "The repository imports and calls a UI component directly." }),
      finding({ lineStart: 6, lineEnd: 8, category: "maintainability", description: "The returned object now embeds a rendered React element, breaking the Repository type contract." }),
    ];
    expect(mergeDuplicateFindings(findings)).toHaveLength(1);
  });

  it("keeps genuinely distinct, non-overlapping root causes separate", () => {
    const findings = [
      finding({ lineStart: 1, lineEnd: 9, description: "Repository instantiates a concrete AnthropicProvider directly." }),
      finding({ lineStart: 20, lineEnd: 25, description: "A completely unrelated circular import exists between two other modules." }),
    ];
    expect(mergeDuplicateFindings(findings)).toHaveLength(2);
  });
});

describe("canonicalizeCategory (category discipline)", () => {
  it("architecture -> layer-boundaries.cross-layer-import", () => {
    const f = finding({ category: "architecture", description: "The repository imports RepositoryCard, a UI component, directly into the persistence layer." });
    expect(canonicalizeCategory(f).category).toBe("layer-boundaries.cross-layer-import");
  });

  it("architecture -> responsibility-separation.business-logic-leakage", () => {
    const f = finding({ category: "architecture", description: "The verdict-calculation logic is implemented inline inside the finalizeReview server action, coupling business rules to the transport layer." });
    expect(canonicalizeCategory(f).category).toBe("responsibility-separation.business-logic-leakage");
  });

  it("tight-coupling -> coupling.bypasses-port-abstraction", () => {
    const f = finding({ category: "tight-coupling", description: "The repository directly imports and instantiates AnthropicProvider, bypassing the composition root." });
    expect(canonicalizeCategory(f).category).toBe("coupling.bypasses-port-abstraction");
  });

  it("architecture-circular-dependency -> circular-dependency.mutual-module-imports", () => {
    const f = finding({ category: "architecture-circular-dependency", description: "ingest.ts and seed.ts have a circular import between them." });
    expect(canonicalizeCategory(f).category).toBe("circular-dependency.mutual-module-imports");
  });

  it("maintainability -> duplication.domain-logic-duplicated", () => {
    const f = finding({ category: "maintainability", description: "Both files independently define an identical SEVERITY_ORDER array rather than importing a shared definition." });
    expect(canonicalizeCategory(f).category).toBe("duplication.domain-logic-duplicated");
  });

  it("layering-violation -> transaction-orchestration.misplaced-in-adapter", () => {
    const f = finding({ category: "layering-violation", description: "completeReviewWithFindings performs a full multi-step workflow, sequentially issuing database writes and computed inline inside the adapter." });
    expect(canonicalizeCategory(f).category).toBe("transaction-orchestration.misplaced-in-adapter");
  });

  it("scalability -> provider-leakage.vendor-type-in-domain", () => {
    const f = finding({ category: "scalability", description: "The core domain type directly references Anthropic.Messages.Message from the vendor SDK." });
    expect(canonicalizeCategory(f).category).toBe("provider-leakage.vendor-type-in-domain");
  });

  it("never reclassifies into an unrelated domain when the signature doesn't match", () => {
    const f = finding({ category: "architecture", description: "This function is a bit long and could be split up." });
    expect(canonicalizeCategory(f).category).toBe("architecture");
  });

  it("leaves an already-specific category untouched", () => {
    const f = finding({ category: "layer-boundaries.cross-layer-import", description: "anything" });
    expect(canonicalizeCategory(f)).toEqual(f);
  });
});

describe("normalizeArchitectureOutput (full pipeline) — true positives survive", () => {
  it("a genuine layer-boundary finding survives and is canonicalized", () => {
    const context = diffContext({
      "supabase-adapter.ts": [
        "import { RepositoryCard } from '@/components/dashboard/repository-card';",
        "export class SupabaseReviewRepository {",
        "  async listRepositoriesForUser(userId) {",
        "    return rows.map((row) => ({ ...row, displayCard: RepositoryCard({ repository: row }) }));",
        "  }",
        "}",
      ],
    });
    const output = normalizeArchitectureOutput(
      {
        summary: "s",
        findings: [
          finding({
            category: "architecture",
            filePath: "supabase-adapter.ts",
            lineStart: 1,
            lineEnd: 4,
            confidence: 0.9,
            description: "The repository imports RepositoryCard, a UI component, and calls it directly inside listRepositoriesForUser.",
          }),
        ],
      },
      context,
    );
    expect(output.findings).toHaveLength(1);
    expect(output.findings[0]?.category).toBe("layer-boundaries.cross-layer-import");
    expect(output.findings[0]?.confidence).toBe(0.9);
  });

  it("a genuine coupling finding survives and is canonicalized", () => {
    const context = diffContext({
      "supabase-adapter.ts": ["export class SupabaseReviewRepository {", '  private readonly provider = new AnthropicProvider(process.env.ANTHROPIC_API_KEY ?? "");', "}"],
    });
    const output = normalizeArchitectureOutput(
      {
        summary: "s",
        findings: [
          finding({
            category: "tight-coupling",
            filePath: "supabase-adapter.ts",
            lineStart: 1,
            lineEnd: 2,
            confidence: 0.85,
            description: "The repository directly imports and instantiates AnthropicProvider, bypassing the composition root and hardcodes the concrete provider choice.",
          }),
        ],
      },
      context,
    );
    expect(output.findings).toHaveLength(1);
    expect(output.findings[0]?.category).toBe("coupling.bypasses-port-abstraction");
  });

  it("a genuine circular-dependency finding survives and is canonicalized", () => {
    const context = diffContext({ "ingest.ts": ["import { recordReviewCompletion } from '@/server/demo/seed';"] });
    const output = normalizeArchitectureOutput(
      {
        summary: "s",
        findings: [
          finding({
            category: "architecture-circular-dependency",
            filePath: "ingest.ts",
            lineStart: 1,
            lineEnd: 1,
            confidence: 0.9,
            description: "ingest.ts imports from seed.ts, and seed.ts imports back from ingest.ts — a circular import between the two modules.",
          }),
        ],
      },
      context,
    );
    expect(output.findings).toHaveLength(1);
    expect(output.findings[0]?.category).toBe("circular-dependency.mutual-module-imports");
  });

  it("a genuine provider-leakage finding survives and is canonicalized", () => {
    const context = diffContext({ "types.ts": ["export interface Finding {", "  rawProviderMessage: Anthropic.Messages.Message;", "}"] });
    const output = normalizeArchitectureOutput(
      {
        summary: "s",
        findings: [
          finding({
            category: "layering-violation",
            filePath: "types.ts",
            lineStart: 1,
            lineEnd: 3,
            confidence: 0.9,
            description: "The core domain type directly references Anthropic.Messages.Message from the vendor SDK, coupling the domain to one AI provider.",
          }),
        ],
      },
      context,
    );
    expect(output.findings).toHaveLength(1);
    expect(output.findings[0]?.category).toBe("provider-leakage.vendor-type-in-domain");
  });

  it("security finding dropped end-to-end", () => {
    const context = diffContext({ "finalize-review.ts": ["export async function finalizeReview(reviewId) {}"] });
    const output = normalizeArchitectureOutput(
      { summary: "s", findings: [finding({ category: "security", description: "This bypasses the ownership check with a privileged pseudo-user." })] },
      context,
    );
    expect(output.findings).toEqual([]);
  });

  it("never increases the number of findings", () => {
    const context = diffContext({ "x.ts": ["export const x = 1;"] });
    const raw = [finding({ filePath: "x.ts", lineStart: 1, lineEnd: 1 }), finding({ filePath: "x.ts", lineStart: 1, lineEnd: 1 })];
    const output = normalizeArchitectureOutput({ summary: "s", findings: raw }, context);
    expect(output.findings.length).toBeLessThanOrEqual(raw.length);
  });

  it("preserves the summary field untouched", () => {
    const context = diffContext({ "x.ts": ["export const x = 1;"] });
    const output = normalizeArchitectureOutput({ summary: "original summary", findings: [] }, context);
    expect(output.summary).toBe("original summary");
  });
});
