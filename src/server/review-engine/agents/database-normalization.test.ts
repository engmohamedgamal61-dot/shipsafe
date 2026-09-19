import { describe, expect, it } from "vitest";
import type { ProviderFinding } from "@/domain/schemas";
import type { ReviewContext } from "../types";
import {
  canonicalizeCategory,
  downgradeUnseenContextConfidence,
  dropRlsAndAuthConcerns,
  mergeDuplicateFindings,
  normalizeDatabaseOutput,
  redactUnverifiableQuotes,
} from "./database-normalization";

function finding(overrides: Partial<ProviderFinding> = {}): ProviderFinding {
  return {
    severity: "P1",
    title: "Finding",
    description: "Some description.",
    filePath: "migration.sql",
    lineStart: 5,
    lineEnd: 5,
    category: "data-integrity",
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

describe("dropRlsAndAuthConcerns (reviewer lane discipline)", () => {
  it("RLS/security finding is dropped from Database Reviewer output, by category", () => {
    const findings = [finding({ category: "security" }), finding({ category: "tenant-isolation" }), finding({ category: "rls" })];
    expect(dropRlsAndAuthConcerns(findings)).toEqual([]);
  });

  it("RLS/security finding is dropped even when mislabeled under a generic category, by content", () => {
    const findings = [
      finding({
        category: "data-integrity",
        description: "The migration never runs alter table ... enable row level security, so any role with default grants can read or write filters belonging to other workspaces.",
      }),
    ];
    expect(dropRlsAndAuthConcerns(findings)).toEqual([]);
  });

  it("drops a finding citing default anon/authenticated role access", () => {
    const findings = [finding({ category: "data-integrity", description: "Without a policy, the anon role can read every row via PostgREST." })];
    expect(dropRlsAndAuthConcerns(findings)).toEqual([]);
  });

  it("does NOT drop a legitimate schema-layer tenant-scoping finding that never mentions RLS/policies/roles", () => {
    const findings = [
      finding({
        category: "data-integrity",
        description: "The unique constraint on (name) is not scoped by workspace_id, so two different workspaces cannot both use the same key name — a constraint design defect, not an access-control gap.",
      }),
    ];
    expect(dropRlsAndAuthConcerns(findings)).toEqual(findings);
  });

  it("keeps genuine database-layer categories untouched", () => {
    const findings = [finding({ category: "foreign-keys.missing-reference" }), finding({ category: "transaction-boundary.non-atomic-multi-step-write" })];
    expect(dropRlsAndAuthConcerns(findings)).toEqual(findings);
  });
});

describe("downgradeUnseenContextConfidence (ambiguity/confidence calibration)", () => {
  it("caps confidence to low when the description admits impact depends on unseen table size", () => {
    const f = finding({ confidence: 0.7, description: "If the reviews table is large, this can cause extended write blocking during the index build." });
    expect(downgradeUnseenContextConfidence(f).confidence).toBeLessThan(0.5);
  });

  it("caps confidence to low for 'no information about size/traffic' hedging", () => {
    const f = finding({ confidence: 0.9, description: "The migration provides no information about the current size of the table, so it's impossible to assess the lock/build time." });
    expect(downgradeUnseenContextConfidence(f).confidence).toBeLessThan(0.5);
  });

  it("caps confidence to low for deployment-window hedging", () => {
    const f = finding({ confidence: 0.8, description: "Whether this is acceptable depends on the production deployment window." });
    expect(downgradeUnseenContextConfidence(f).confidence).toBeLessThan(0.5);
  });

  it("never raises confidence — a finding already below the cap is left untouched", () => {
    const f = finding({ confidence: 0.1, description: "Depending on production traffic, this may or may not be an issue." });
    expect(downgradeUnseenContextConfidence(f).confidence).toBe(0.1);
  });

  it("leaves a confidently and concretely demonstrated finding's confidence untouched", () => {
    const f = finding({ confidence: 0.9, description: "add column active_rule_version text not null supplies no default; this migration fails outright against an already-populated table." });
    expect(downgradeUnseenContextConfidence(f).confidence).toBe(0.9);
  });
});

describe("redactUnverifiableQuotes (evidence precision)", () => {
  const rlsContext = diffContext({
    "migration.sql": ["create table if not exists public.saved_filters (", "  workspace_id uuid not null references public.workspaces (id)", ");"],
  });

  it("a hypothetical SQL quote is not treated as literal evidence", () => {
    const f = finding({
      filePath: "migration.sql",
      description: "The migration never runs `alter table public.saved_filters enable row level security;`.",
    });
    const result = redactUnverifiableQuotes(f, rlsContext);
    expect(result.description).not.toContain("enable row level security");
    expect(result.description).toContain("[unverified quote removed]");
  });

  const transferContext = diffContext({
    "transfer-ownership.ts": ["await supabase", "  .from('workspace_memberships')", "  .update({ role: 'member' })"],
  });

  it("an inferred response field is not treated as literal evidence", () => {
    const f = finding({
      filePath: "transfer-ownership.ts",
      description: "Neither call checks the `error` field returned by Supabase.",
    });
    const result = redactUnverifiableQuotes(f, transferContext);
    expect(result.description).not.toContain("`error`");
    expect(result.description).toContain("[unverified quote removed]");
  });

  it("leaves an exact, verbatim quote untouched", () => {
    const f = finding({ filePath: "migration.sql", description: "References `public.workspaces (id)` correctly." });
    expect(redactUnverifiableQuotes(f, rlsContext).description).toBe(f.description);
  });

  it("never drops the finding itself for one bad quote", () => {
    const f = finding({ filePath: "migration.sql", description: "Missing `enable row level security;`." });
    const result = redactUnverifiableQuotes(f, rlsContext);
    expect(result.severity).toBe(f.severity);
    expect(result.category).toBe(f.category);
  });
});

describe("mergeDuplicateFindings (same database root cause merges to one finding)", () => {
  it("two findings restating the same missing-foreign-key defect from different angles merge into one", () => {
    const findings = [
      finding({ lineStart: 4, lineEnd: 9, description: "repository_id has no foreign key reference to public.repositories." }),
      finding({ lineStart: 4, lineEnd: 9, category: "data-integrity", description: "Even if a foreign key is added, no ON DELETE behavior is specified." }),
    ];
    expect(mergeDuplicateFindings(findings)).toHaveLength(1);
  });

  it("keeps genuinely distinct, non-overlapping root causes separate", () => {
    const findings = [
      finding({ lineStart: 6, lineEnd: 6, description: "actor_id cascades on delete, erasing audit history." }),
      finding({ lineStart: 11, lineEnd: 11, description: "No index exists on actor_id despite frequent lookups." }),
    ];
    expect(mergeDuplicateFindings(findings)).toHaveLength(2);
  });
});

describe("canonicalizeCategory (category specificity)", () => {
  it("data-integrity -> foreign-keys.missing-reference", () => {
    const f = finding({ category: "data-integrity", description: "The table does not declare repository_id as a foreign key referencing repositories, so referential integrity is not enforced." });
    expect(canonicalizeCategory(f).category).toBe("foreign-keys.missing-reference");
  });

  it("data-integrity -> nullability.missing-not-null", () => {
    const f = finding({ category: "data-integrity", description: "amount_cents is defined without a NOT NULL constraint, which is semantically invalid for a billing record." });
    expect(canonicalizeCategory(f).category).toBe("nullability.missing-not-null");
  });

  it("data-integrity -> cascade-delete.unsafe-cascade", () => {
    const f = finding({ category: "data-integrity", description: "actor_id references profiles on delete cascade, so deleting a user erases their audit history." });
    expect(canonicalizeCategory(f).category).toBe("cascade-delete.unsafe-cascade");
  });

  it("data-integrity -> race-condition.missing-unique-constraint", () => {
    const f = finding({ category: "data-integrity", description: "There is no unique or partial unique index, so a classic race condition allows concurrent requests to create duplicate invitations." });
    expect(canonicalizeCategory(f).category).toBe("race-condition.missing-unique-constraint");
  });

  it("database-migration-safety -> migration-safety.unsafe-not-null-addition", () => {
    const f = finding({ category: "database-migration-safety", description: "The migration adds column active_rule_version text not null with no default, so ALTER TABLE will fail on any existing row." });
    expect(canonicalizeCategory(f).category).toBe("migration-safety.unsafe-not-null-addition");
  });

  it("performance -> performance.n-plus-one", () => {
    const f = finding({ category: "performance", description: "The function loops over every pull request and issues a separate query for each one, resulting in N sequential round trips." });
    expect(canonicalizeCategory(f).category).toBe("performance.n-plus-one");
  });

  it("data-integrity -> transaction-boundary.non-atomic-multi-step-write", () => {
    const f = finding({ category: "data-integrity", description: "The function issues two separate update calls with no surrounding transaction, so a partial failure leaves zero owners." });
    expect(canonicalizeCategory(f).category).toBe("transaction-boundary.non-atomic-multi-step-write");
  });

  it("never reclassifies into an unrelated domain when the signature doesn't match", () => {
    const f = finding({ category: "data-integrity", description: "The action column is free-form text with no enum/check constraint." });
    expect(canonicalizeCategory(f).category).toBe("data-integrity");
  });

  it("leaves an already-specific category untouched", () => {
    const f = finding({ category: "foreign-keys.missing-reference", description: "anything" });
    expect(canonicalizeCategory(f)).toEqual(f);
  });
});

describe("normalizeDatabaseOutput (full pipeline) — true positives survive", () => {
  it("a genuine missing-foreign-key finding survives and is canonicalized", () => {
    const context = diffContext({
      "migration.sql": [
        "create table if not exists public.webhook_deliveries (",
        "  id uuid primary key default gen_random_uuid(),",
        "  repository_id uuid not null,",
        ");",
      ],
    });
    const output = normalizeDatabaseOutput(
      {
        summary: "s",
        findings: [
          finding({
            category: "data-integrity",
            filePath: "migration.sql",
            lineStart: 3,
            lineEnd: 3,
            confidence: 0.9,
            description: "repository_id uuid not null has no foreign key reference to public.repositories, so referential integrity is not enforced and orphaned rows can accumulate.",
          }),
        ],
      },
      context,
    );
    expect(output.findings).toHaveLength(1);
    expect(output.findings[0]?.category).toBe("foreign-keys.missing-reference");
    expect(output.findings[0]?.confidence).toBe(0.9);
  });

  it("a genuine non-atomic transaction finding survives at full confidence", () => {
    const context = diffContext({
      "transfer-ownership.ts": ["await supabase.from('workspace_memberships').update({ role: 'member' });", "await supabase.from('workspace_memberships').update({ role: 'owner' });"],
    });
    const output = normalizeDatabaseOutput(
      {
        summary: "s",
        findings: [
          finding({
            category: "data-integrity",
            filePath: "transfer-ownership.ts",
            lineStart: 1,
            lineEnd: 2,
            confidence: 0.85,
            description: "The function issues two separate update calls with no surrounding transaction; a partial failure leaves the workspace with zero owners.",
          }),
        ],
      },
      context,
    );
    expect(output.findings).toHaveLength(1);
    expect(output.findings[0]?.category).toBe("transaction-boundary.non-atomic-multi-step-write");
    expect(output.findings[0]?.confidence).toBe(0.85);
  });

  it("a genuine unsafe-migration finding survives and is canonicalized", () => {
    const context = diffContext({ "migration.sql": ["alter table public.repositories", "  add column active_rule_version text not null;"] });
    const output = normalizeDatabaseOutput(
      {
        summary: "s",
        findings: [
          finding({
            category: "database-migration-safety",
            filePath: "migration.sql",
            lineStart: 1,
            lineEnd: 2,
            confidence: 0.95,
            severity: "P0",
            description: "This adds column active_rule_version text not null with no default; ALTER TABLE will fail immediately against any already-populated table.",
          }),
        ],
      },
      context,
    );
    expect(output.findings).toHaveLength(1);
    expect(output.findings[0]?.category).toBe("migration-safety.unsafe-not-null-addition");
    expect(output.findings[0]?.severity).toBe("P0");
  });

  it("RLS/security finding excluded end-to-end", () => {
    const context = diffContext({ "migration.sql": ["create table if not exists public.saved_filters (id uuid);"] });
    const output = normalizeDatabaseOutput(
      { summary: "s", findings: [finding({ category: "security", description: "No RLS enabled on this tenant-scoped table." })] },
      context,
    );
    expect(output.findings).toEqual([]);
  });

  it("never increases the number of findings", () => {
    const context = diffContext({ "migration.sql": ["create table public.x (id uuid);"] });
    const raw = [finding({ filePath: "migration.sql", lineStart: 1, lineEnd: 1 }), finding({ filePath: "migration.sql", lineStart: 1, lineEnd: 1 })];
    const output = normalizeDatabaseOutput({ summary: "s", findings: raw }, context);
    expect(output.findings.length).toBeLessThanOrEqual(raw.length);
  });

  it("preserves the summary field untouched", () => {
    const context = diffContext({ "migration.sql": ["create table public.x (id uuid);"] });
    const output = normalizeDatabaseOutput({ summary: "original summary", findings: [] }, context);
    expect(output.summary).toBe("original summary");
  });
});
