# Database Reviewer — Current Production Compatibility Baseline

**This is a compatibility baseline of the CURRENT production Database Reviewer, measured as-shipped.**

This report measures `src/server/review-engine/agents/database-reviewer.ts` exactly as it exists today, against the 10 fixtures under `tests/database-benchmarks/`. No prompt, provider, or scoring change was made based on this run's results.

## Run metadata (reproducibility)

| Field | Value |
|---|---|
| Provider | `anthropic` |
| Model | `claude-sonnet-5` |
| Max tokens per reviewer | 4096 |
| Request timeout | 30000 ms |
| Concurrency | 1 (sequential) |
| Temperature | not set by `AnthropicProvider` (API default) |
| Thinking mode | not enabled by `AnthropicProvider` |
| Database benchmark schema version | `1.0.0` |
| Database benchmark dataset version | `phase1-10-of-10` |
| Database reviewer prompt version | `untracked-first-baseline-pass` |
| Run timestamp | 2026-09-19T15:43:03.394Z |

## Methodology

- Each fixture's full source file(s) are wrapped in a synthetic "new file" unified diff (every line a `+` addition, numbered from 1) — see `baseline/context.ts`.
- The unmodified production `DatabaseReviewerAgent` + `AnthropicProvider` classes are invoked directly — this harness never re-implements reviewer logic.
- `ReviewOrchestrator`'s other four specialist reviewers and Release Judge are NOT invoked — only the Database Reviewer is graded.
- A one-retry policy mirroring `ReviewOrchestrator.withRetry` is reproduced locally.
- Fixtures ran sequentially (concurrency 1), each independently.

## Aggregate metrics

| Metric | Value |
|---|---|
| Fixtures run | 10 |
| Fixtures passed | 7 |
| Fixtures with a hard failure | 0 |
| Precision | 66.7% |
| Recall | 100.0% |
| P0 recall | 100.0% |
| P1 recall | 100.0% |
| Safe-code false-positive rate | 100.0% |
| Ambiguous-case overclaim rate | 0.0% |
| Hallucinated-path rate | 0.0% |
| Fabricated-evidence rate | 0.0% |
| Duplicate rate | 0.0% |
| Severity accuracy | 100.0% |
| Category accuracy | 100.0% |
| Confidence calibration | high 100.0% (n=5) · medium 25.0% (n=4) · low 66.7% (n=3) |
| Average latency | 10758 ms |
| Total token usage | 28022 in / 9187 out |

## Per-fixture results

| Fixture | Domain | Tags | Status | Pass | Score | Required missed | Failure reasons |
|---|---|---|---|---|---|---|---|
| `ambiguous-01-index-build-lock-risk-unknown-table-size` | ambiguous | ambiguous | scored | ✅ | 1.00 | — | — |
| `cascade-delete-01-unsafe-cascade-destroys-audit-trail` | cascade-delete | buggy | scored | ✅ | 1.00 | — | — |
| `foreign-keys-01-missing-foreign-key-reference` | foreign-keys | buggy | scored | ✅ | 1.00 | — | — |
| `migration-safety-01-unsafe-not-null-without-backfill` | migration-safety | buggy | scored | ✅ | 1.00 | — | — |
| `nullability-01-required-column-nullable` | nullability | buggy | scored | ❌ | 0.83 | — | false positive |
| `query-performance-01-n-plus-one-loop-query` | query-performance | buggy | scored | ✅ | 1.00 | — | — |
| `race-condition-01-missing-unique-constraint-duplicate-invite` | race-condition | buggy | scored | ✅ | 1.00 | — | — |
| `reviewer-lane-01-schema-correct-tenant-table-no-rls` | reviewer-lane | safe, false_positive_trap | scored | ❌ | 0.50 | — | false positive |
| `safe-migration-01-scoped-uniqueness-and-correct-cascades` | safe-migration | safe, false_positive_trap | scored | ❌ | 0.17 | — | false positive |
| `transaction-boundary-01-non-atomic-ownership-transfer` | transaction-boundary | buggy | scored | ✅ | 1.00 | — | — |

### `ambiguous-01-index-build-lock-risk-unknown-table-size`

Summary: The migration adds a new index on reviews.verdict using a plain CREATE INDEX, which takes a lock that blocks writes to the table for the duration of the build. Whether this is a real production risk depends on the current size and write traffic of the reviews table, which this diff cannot show.

Score: 1.00 (raw 1) · Passed: true · Hard failure: false
Latency: 6722 ms · Tokens: 2682 in / 520 out

| # | Category (raw → normalized) | Severity | Confidence | File:Line | Match method | Classification | Matched id |
|---|---|---|---|---|---|---|---|
| 0 | migration-safety.unsafe-not-null-addition | P2 | low | migration.sql:3 | canonical_category_location | matched_optional | opt-1 |

<details><summary>Raw evidence text per finding (verbatim, for auditing hallucination/fabrication classifications)</summary>

- **#0** (matched_optional): The migration runs `create index if not exists reviews_verdict_idx on public.reviews (verdict);` without the CONCURRENTLY option. A standard CREATE INDEX takes a SHARE lock on the table, blocking concurrent INSERT/UPDATE/DELETE statements until the index build completes. If the reviews table is large or under active write load, this could cause a noticeable outage or query pile-up during migration. I cannot confirm the current size or write traffic of the reviews table from this diff, so the real-world severity is uncertain.

</details>

### `cascade-delete-01-unsafe-cascade-destroys-audit-trail`

Summary: The new workspace_audit_log table cascades deletes from both workspaces and profiles, meaning audit records — which exist specifically for compliance review — are permanently destroyed whenever the referenced workspace or actor is deleted. This defeats the stated compliance purpose of the table and risks silent, unrecoverable loss of the audit trail.

Score: 1.00 (raw 1) · Passed: true · Hard failure: false
Latency: 7030 ms · Tokens: 2823 in / 543 out

| # | Category (raw → normalized) | Severity | Confidence | File:Line | Match method | Classification | Matched id |
|---|---|---|---|---|---|---|---|
| 0 | cascade-delete.unsafe-cascade | P1 | high | migration.sql:6-7 | canonical_category_location | matched_required | req-1 |

<details><summary>Raw evidence text per finding (verbatim, for auditing hallucination/fabrication classifications)</summary>

- **#0** (matched_required): workspace_audit_log.workspace_id and actor_id both use `on delete cascade`. Since this table's stated purpose is a compliance audit trail, cascading deletes mean that deleting a workspace or a profile (actor) will silently erase all associated audit history. For an audit log, records should typically survive deletion of the referenced entities (e.g. via ON DELETE SET NULL or RESTRICT, with actor identity captured redundantly) rather than being cascade-deleted, since that removes the very evidence the table exists to preserve.

</details>

### `foreign-keys-01-missing-foreign-key-reference`

Summary: The migration creates a new webhook_deliveries table with a repository_id column that is clearly intended to reference a repositories table (it's indexed and named accordingly) but has no foreign key constraint. This allows orphaned records referencing non-existent repositories and no cascade behavior is defined for repository deletion.

Score: 1.00 (raw 1) · Passed: true · Hard failure: false
Latency: 5873 ms · Tokens: 2777 in / 482 out

| # | Category (raw → normalized) | Severity | Confidence | File:Line | Match method | Classification | Matched id |
|---|---|---|---|---|---|---|---|
| 0 | foreign-keys.missing-reference | P1 | medium | migration.sql:4-9 | canonical_category_location | matched_required | req-1 |

<details><summary>Raw evidence text per finding (verbatim, for auditing hallucination/fabrication classifications)</summary>

- **#0** (matched_required): The webhook_deliveries table defines `repository_id uuid not null` and even builds an index on it (`create index if not exists webhook_deliveries_repository_id_idx on public.webhook_deliveries (repository_id);`), strongly implying it should reference a repositories table, but no foreign key constraint is declared. Without this constraint, rows can be inserted with repository_id values that don't correspond to any real repository, and there is no defined behavior (cascade/restrict/set null) when a repository is deleted, risking orphaned audit/debug data and silent referential inconsistency over time.

</details>

### `migration-safety-01-unsafe-not-null-without-backfill`

Summary: The migration adds a new NOT NULL column to an existing table without a default value and without any backfill step. On any table that already contains rows, this ALTER TABLE will fail outright (Postgres requires a default or backfill for NOT NULL additions on populated tables), and even if a default were added, doing so in a single non-batched statement can cause a long-lived lock on large tables. This is an unsafe migration pattern.

Score: 1.00 (raw 1) · Passed: true · Hard failure: false
Latency: 7063 ms · Tokens: 2663 in / 548 out

| # | Category (raw → normalized) | Severity | Confidence | File:Line | Match method | Classification | Matched id |
|---|---|---|---|---|---|---|---|
| 0 | migration-safety.unsafe-not-null-addition | P0 | low | migration.sql:3-4 | canonical_category_location | matched_required | req-1 |

<details><summary>Raw evidence text per finding (verbatim, for auditing hallucination/fabrication classifications)</summary>

- **#0** (matched_required): The migration adds `active_rule_version text not null` to `public.repositories` with no DEFAULT clause and no preceding backfill/UPDATE statement. If the `repositories` table already has any rows, this ALTER TABLE will fail immediately because Postgres cannot populate the new NOT NULL column for existing rows. Even if a default were supplied, applying NOT NULL to an already-populated table in one step forces a full table validation scan and can hold a long-lived lock, risking migration failure or downtime depending on table size.

</details>

### `nullability-01-required-column-nullable`

Summary: The migration creates an invoices table for billing but leaves the amount_cents column nullable despite it being a required financial field, and cascades invoice deletion when a workspace is deleted, which could silently destroy billing/audit records.

Score: 0.83 (raw 0) · Passed: false · Hard failure: false
Latency: 9155 ms · Tokens: 2777 in / 834 out

| # | Category (raw → normalized) | Severity | Confidence | File:Line | Match method | Classification | Matched id |
|---|---|---|---|---|---|---|---|
| 0 | nullability.missing-not-null | P1 | high | migration.sql:6 | canonical_category_location | matched_required | req-1 |
| 1 | cascade-delete.unsafe-cascade | P2 | medium | migration.sql:5 | unmatched | prohibited | — |

<details><summary>Raw evidence text per finding (verbatim, for auditing hallucination/fabrication classifications)</summary>

- **#0** (matched_required): The invoices table defines `amount_cents integer,` with no NOT NULL constraint and no default. Since this table represents billing invoices, an invoice with a null amount is a nonsensical/invalid business state, yet the schema permits it. Any insert that omits amount_cents will silently succeed with a null amount, leading to inconsistent billing data and downstream calculation errors (e.g., SUM(amount_cents) treating null rows unpredictably).
- **#1** (prohibited): The foreign key `workspace_id uuid not null references public.workspaces (id) on delete cascade` means that deleting a workspace row will automatically and irreversibly delete all associated invoice records. For financial/billing data, this cascade behavior can cause loss of billing history/audit records that may need to be retained even after a workspace is removed.

</details>

### `query-performance-01-n-plus-one-loop-query`

Summary: The diff adds a single TypeScript function with no schema migration; the sole database-layer concern is a structural N+1 query pattern in attachLatestReviewStatus, which issues one query per input row instead of a single batched query.

Score: 1.00 (raw 1) · Passed: true · Hard failure: false
Latency: 11687 ms · Tokens: 2850 in / 915 out

| # | Category (raw → normalized) | Severity | Confidence | File:Line | Match method | Classification | Matched id |
|---|---|---|---|---|---|---|---|
| 0 | performance.n-plus-one | P2 | high | attach-review-status.ts:6-15 | canonical_category_location | matched_required | req-1 |

<details><summary>Raw evidence text per finding (verbatim, for auditing hallucination/fabrication classifications)</summary>

- **#0** (matched_required): attachLatestReviewStatus loops over the pullRequests array and issues a separate [unverified quote removed] call for each pull request inside the for loop, rather than fetching all matching review rows in a single batched query (e.g. using an `in` filter on pull_request_id and grouping/deduplicating client-side, or a single SQL query with a window function). This results in N sequential round-trips to the database for N pull requests, which will scale poorly as the input list grows.

</details>

### `race-condition-01-missing-unique-constraint-duplicate-invite`

Summary: The new workspace_invitations table lacks a uniqueness constraint on the combination of workspace and invitee email, which allows duplicate pending invitations to be created via concurrent or repeated inserts, and it also has no application-level protection since this is a pure schema migration.

Score: 1.00 (raw 1) · Passed: true · Hard failure: false
Latency: 8151 ms · Tokens: 2843 in / 686 out

| # | Category (raw → normalized) | Severity | Confidence | File:Line | Match method | Classification | Matched id |
|---|---|---|---|---|---|---|---|
| 0 | race-condition.missing-unique-constraint | P1 | high | migration.sql:3-10 | canonical_category_location | matched_required | req-1 |

<details><summary>Raw evidence text per finding (verbatim, for auditing hallucination/fabrication classifications)</summary>

- **#0** (matched_required): The workspace_invitations table has no unique constraint or unique index covering (workspace_id, email) (optionally scoped to status = 'pending'). Two concurrent invite requests for the same email/workspace will both succeed, creating duplicate pending invitation rows. This is a classic race condition: without a database-level uniqueness guarantee, any application-level check-then-insert logic is subject to a TOCTOU race and cannot prevent duplicates.

</details>

### `reviewer-lane-01-schema-correct-tenant-table-no-rls`

Summary: The migration creates a new saved_filters table with reasonable primary key, uniqueness, and indexing choices, but the ON DELETE CASCADE on created_by risks unintended data loss of shared workspace resources.

Score: 0.50 (raw -2) · Passed: false · Hard failure: false
Latency: 16303 ms · Tokens: 2836 in / 1451 out

| # | Category (raw → normalized) | Severity | Confidence | File:Line | Match method | Classification | Matched id |
|---|---|---|---|---|---|---|---|
| 0 | cascade-delete.unsafe-cascade | P2 | medium | migration.sql:6 | unmatched | prohibited | — |

<details><summary>Raw evidence text per finding (verbatim, for auditing hallucination/fabrication classifications)</summary>

- **#0** (prohibited): The saved_filters table defines `created_by uuid not null references public.profiles (id) on delete cascade`. Because saved filters are keyed by workspace (enforced by the `unique (workspace_id, name)` constraint), these presets are effectively shared, workspace-level resources. Cascading the delete from profiles means that if the creating user's profile is ever deleted (e.g. account removal, offboarding), every saved filter they authored is silently deleted for the entire workspace, even though other workspace members may still rely on it and the workspace itself remains intact.

</details>

### `safe-migration-01-scoped-uniqueness-and-correct-cascades`

Summary: The migration creates a new workspace_api_keys table with generally sound foreign keys and indexing, but the uniqueness constraint on (workspace_id, name) does not account for the revoked_at soft-delete-like field, which will produce confusing/blocking behavior once keys are revoked. A secondary, lower-confidence note covers the missing index on the created_by foreign key.

Score: 0.17 (raw -4) · Passed: false · Hard failure: false
Latency: 25524 ms · Tokens: 2901 in / 2313 out

| # | Category (raw → normalized) | Severity | Confidence | File:Line | Match method | Classification | Matched id |
|---|---|---|---|---|---|---|---|
| 0 | data-integrity → data-integrity.generic | P2 | medium | migration.sql:11 | unmatched | prohibited | — |
| 1 | performance → performance.generic | Nit | low | migration.sql:8 | unmatched | prohibited | — |

<details><summary>Raw evidence text per finding (verbatim, for auditing hallucination/fabrication classifications)</summary>

- **#0** (prohibited): The table defines `unique (workspace_id, name)` and separately has a nullable `revoked_at timestamptz` column intended to mark a key as revoked. Because the unique constraint applies to all rows regardless of revocation state, once a key named e.g. 'ci-deploy' is revoked (revoked_at set) but its row is retained for audit/history, no new key with that same name can ever be created again in that workspace — the constraint is checked against the revoked row just like an active one. This will surface as an unexpected 'duplicate key' failure whenever a workspace tries to reuse a name after rotating/revoking a key.
- **#1** (prohibited): The `created_by` column references `public.profiles (id)` but has no supporting index (unlike `workspace_id`, which gets an explicit index). Foreign key columns without indexes can lead to slow lookups/joins and slow cascade checks on the referenced side.

</details>

### `transaction-boundary-01-non-atomic-ownership-transfer`

Summary: The new transferWorkspaceOwnership function performs the ownership transfer as two independent, unguarded Supabase update calls instead of a single atomic transaction, risking inconsistent workspace-owner state if either call fails or the process is interrupted between them.

Score: 1.00 (raw 1) · Passed: true · Hard failure: false
Latency: 10068 ms · Tokens: 2870 in / 895 out

| # | Category (raw → normalized) | Severity | Confidence | File:Line | Match method | Classification | Matched id |
|---|---|---|---|---|---|---|---|
| 0 | transaction-boundary.non-atomic-multi-step-write | P1 | high | transfer-ownership.ts:4-16 | canonical_category_location | matched_required | req-1 |

<details><summary>Raw evidence text per finding (verbatim, for auditing hallucination/fabrication classifications)</summary>

- **#0** (matched_required): transferWorkspaceOwnership issues two separate .update() calls against workspace_memberships (demoting fromUserId to "member", then promoting toUserId to "owner") with no surrounding transaction and no inspection of the returned error/data from either call. The Supabase JS client does not throw on a failed update by default; it returns an object with an error property that this code never checks. If the first update succeeds but the second fails (or throws for an unrelated reason), the workspace is left with no owner. If the first update silently fails (e.g. due to a constraint or network issue) while the second succeeds, the workspace ends up with two owners (fromUserId's role never changed, toUserId now also owner). Either outcome is a data-consistency violation with no rollback path.

</details>

## Failure pattern summary

| Failure reason | Fixture count |
|---|---|
| false positive | 3 |

