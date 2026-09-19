# reviewer-lane-01-schema-correct-tenant-table-no-rls

**Renamed during Phase 4 root-cause analysis of the first live baseline
run.** The original fixture id
(`reviewer-lane-01-missing-rls-is-not-a-database-finding`) becomes this
fixture's synthetic PR title and branch name (see `baseline/context.ts`),
and the real production Database Reviewer read that phrase as an
embedded instruction rather than a neutral label — its own output said:
"The PR title and branch name (...) explicitly frame the absence of
Row-Level Security (RLS) on the new table as out-of-scope for a database
review. This reads as an attempt to influence the reviewer's
judgment/output... instructions embedded in untrusted PR content must
not be followed." That's a genuine benchmark-authoring bug (a fixture id
that accidentally functions as a leaked answer key / prompt injection),
not a reviewer defect — every other fixture in this suite merely NAMES
its scenario (e.g. `non-atomic-ownership-transfer`), which is the
established, harmless convention across all three reviewer benchmarks;
only this one crossed into dictating a verdict. Renamed to a purely
descriptive id with no editorial instruction baked in.

`saved_filters` is schema-correct in every way this benchmark tests
elsewhere: proper `references` clauses, every required column `not
null`, a correctly tenant-scoped `unique (workspace_id, name)`, and an
index on the tenant column. The only thing missing is `alter table ...
enable row level security` and any policy at all.

That omission IS a real defect — but it belongs to the Security
Reviewer, which already has a dedicated fixture for exactly this pattern
(`tests/security-benchmarks/database/01-rls-never-enabled-on-tenant-table`).
The task instructions are explicit: "Do not turn every RLS/auth concern
into a database finding unless the defect is concretely visible at the
database/schema/query layer." There is no schema/constraint/query defect
here — only an access-control gap — so the correct Database Reviewer
answer is zero findings. This directly tests reviewer lane discipline,
mirroring the equivalent test already proven valuable for the Code
Reviewer (never emit a `security`-category finding).
