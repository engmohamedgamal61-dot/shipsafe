# Release Judge — Current Production Compatibility Baseline

**This is a compatibility baseline of the CURRENT production Release Judge, measured as-shipped.**

This report measures `src/server/review-engine/providers/judge-provider.ts`'s `AnthropicJudgeProvider` exactly as it exists today, against the 10 fixtures under `tests/release-judge-benchmarks/`. No prompt, provider, orchestrator, or verdict-floor change was made based on this run's results.

## Run metadata (reproducibility)

| Field | Value |
|---|---|
| Provider | `anthropic` |
| Model | `claude-sonnet-5` |
| Max tokens | 4096 |
| Request timeout | 30000 ms |
| Concurrency | 1 (sequential) |
| Release Judge benchmark schema version | `1.2.0` |
| Release Judge benchmark dataset version | `phase1-10-of-10` |
| Release Judge prompt version | `tuning-pass-1-minimum-verdict-floor` |
| Run timestamp | 2026-09-19T19:10:49.699Z |

## Methodology

- Each fixture is a set of SIMULATED specialist `ReviewerRun`s (never raw code/diff) — see `baseline/context.ts`.
- The unmodified production `ReleaseJudgeAgent` (wrapping the real `AnthropicJudgeProvider`) is invoked directly with those `ReviewerRun[]` — `ReviewOrchestrator` (and its `checkRequiredReviewers`/`applyVerdictFloor` gating) is NOT invoked, so this measures the judge's own raw behavior, not the system-level guaranteed outcome.
- The deterministic floor (`@/domain/verdict`'s `minimumVerdictFor`) is computed from each fixture's findings via the real, unmodified domain function and reported alongside the judge's raw verdict for every fixture, never reimplemented independently.
- A one-retry policy mirroring `ReviewOrchestrator.withRetry` is reproduced locally.
- Fixtures ran sequentially (concurrency 1), each independently.
- `failed-reviewer-01` is a raw-judge-only adversarial probe: production's unmodified `checkRequiredReviewers` blocks before the judge is ever consulted when required-reviewer coverage is incomplete, so this fixture's result is recorded but EXCLUDED from every production-facing metric (verdict accuracy, blocking-defect recall, missed-blocker rate, false-block rate) — see `scorer.ts`'s `countsTowardProductionFacingMetrics` and the separate `rawJudgeFailedReviewerHandlingRate`.

## Aggregate metrics

| Metric | Value |
|---|---|
| Fixtures run | 10 |
| Production-facing fixtures (excludes raw-judge-only probes) | 9 |
| Fixtures passed | 9 |
| Verdict accuracy (production-facing) | 100.0% |
| Blocking-defect recall (production-facing) | 100.0% |
| False-block rate (production-facing) | 0.0% |
| Missed-blocker rate (production-facing) | 0.0% |
| Duplicate-risk inflation rate | 0.0% |
| Low-confidence over-escalation rate | 0.0% |
| Raw-judge-only failed-reviewer handling rate (NOT production-facing — see note below) | 0.0% |
| Severity-floor compliance rate | 100.0% |
| Rationale grounding accuracy | 100.0% |
| Hallucinated-finding rate | 0.0% |
| Average latency | 4641 ms |
| Total token usage | 15295 in / 3114 out |

## Per-fixture results

| Fixture | Domain | Tags | Status | Pass | Actual verdict | Expected verdict | Floor | Failure symptoms |
|---|---|---|---|---|---|---|---|---|
| `aggregate-risk-01-multiple-p2-across-reviewers` | aggregate-risk | aggregate-risk | scored | ✅ | APPROVE_WITH_MINOR_FIXES | APPROVE_WITH_MINOR_FIXES | APPROVE_WITH_MINOR_FIXES | — |
| `ambiguous-01-low-confidence-p1-finding` | ambiguous | ambiguous | scored | ✅ | APPROVE_WITH_MINOR_FIXES | APPROVE_WITH_MINOR_FIXES | APPROVE_WITH_MINOR_FIXES | — |
| `clean-01-clean-release` | clean | clean | scored | ✅ | APPROVE | APPROVE | APPROVE | — |
| `confirmed-blocker-01-single-p1-security-finding` | confirmed-blocker | confirmed-blocker | scored | ✅ | DO_NOT_APPROVE | DO_NOT_APPROVE | APPROVE_WITH_MINOR_FIXES | — |
| `confirmed-blocker-02-single-p0-finding` | confirmed-blocker | confirmed-blocker | scored | ✅ | DO_NOT_APPROVE | DO_NOT_APPROVE | DO_NOT_APPROVE | — |
| `conflicting-signals-01-single-p1-among-clean-reviewers` | conflicting-signals | conflicting-signals | scored | ✅ | APPROVE_WITH_MINOR_FIXES | APPROVE_WITH_MINOR_FIXES | APPROVE_WITH_MINOR_FIXES | — |
| `duplicate-01-same-root-cause-two-reviewers` | duplicate | duplicate | scored | ✅ | APPROVE_WITH_MINOR_FIXES | APPROVE_WITH_MINOR_FIXES | APPROVE_WITH_MINOR_FIXES | — |
| `failed-reviewer-01-required-reviewer-failed` | failed-reviewer | failed-reviewer | scored | ❌ | APPROVE_WITH_MINOR_FIXES | DO_NOT_APPROVE | APPROVE | missed blocker, failed-reviewer gap not recognized by judge |
| `minor-only-01-nit-and-p2-only` | minor-only | minor-only | scored | ✅ | APPROVE_WITH_MINOR_FIXES | APPROVE_WITH_MINOR_FIXES | APPROVE_WITH_MINOR_FIXES | — |
| `mixed-severity-01-realistic-release` | mixed-severity | mixed-severity | scored | ✅ | APPROVE_WITH_MINOR_FIXES | APPROVE_WITH_MINOR_FIXES | APPROVE_WITH_MINOR_FIXES | — |

### `aggregate-risk-01-multiple-p2-across-reviewers`

Judge summary (verbatim): No P0/P1 or security issues found. Four P2 findings across code, architecture, database, and test reviewers: duplicated retry logic, a layering violation with a cross-layer import, a missing index on a newly-filtered column, and missing test coverage for the retry-then-succeed path. None are confirmed high-severity blockers, but per policy any findings preclude a clean APPROVE. Recommend addressing these minor issues before release.

Actual: APPROVE_WITH_MINOR_FIXES · Expected: APPROVE_WITH_MINOR_FIXES · Deterministic floor: APPROVE_WITH_MINOR_FIXES · Passed: true
Latency: 3624 ms · Tokens: 1680 in / 174 out

### `ambiguous-01-low-confidence-p1-finding`

Judge summary (verbatim): Code, security, database, and test reviewers reported no findings. The architecture reviewer flagged a single P1 concern about a possible circular dependency between billing/plans.ts and billing/usage.ts, but explicitly noted it is low-confidence and could not be confirmed without seeing usage.ts's full contents. Since a finding exists (even if unconfirmed), the release cannot be a clean APPROVE, but the low-confidence nature of this sole finding does not rise to a confirmed blocker justifying DO_NOT_APPROVE. Recommend addressing/verifying the potential circular dependency before or shortly after release.

Actual: APPROVE_WITH_MINOR_FIXES · Expected: APPROVE_WITH_MINOR_FIXES · Deterministic floor: APPROVE_WITH_MINOR_FIXES · Passed: true
Latency: 4706 ms · Tokens: 1515 in / 401 out

### `clean-01-clean-release`

Judge summary (verbatim): All five specialist reviewers (code, security, architecture, database, test) reported zero findings and no concerns. Since no findings exist across any reviewer, the release meets the bar for full approval.

Actual: APPROVE · Expected: APPROVE · Deterministic floor: APPROVE · Passed: true
Latency: 2350 ms · Tokens: 1385 in / 80 out

### `confirmed-blocker-01-single-p1-security-finding`

Judge summary (verbatim): Security reviewer found a confirmed, high-confidence P1 broken access control issue: the DELETE /api/workspaces/:id endpoint only checks authentication, not workspace membership/ownership, allowing any authenticated user to delete any workspace. This is a severe access control defect that alone warrants DO_NOT_APPROVE per policy. Test reviewer notes the lack of authorization test coverage stems from the same root cause. Code, architecture, and database reviewers found no issues.

Actual: DO_NOT_APPROVE · Expected: DO_NOT_APPROVE · Deterministic floor: APPROVE_WITH_MINOR_FIXES · Passed: true
Latency: 2876 ms · Tokens: 1519 in / 186 out

### `confirmed-blocker-02-single-p0-finding`

Judge summary (verbatim): Four of five reviewers found no issues, but the database reviewer flagged a confirmed P0: migration 0042 irreversibly drops the `legacy_status` column from `reviews` with no backfill, backup, or down-migration, permanently destroying any existing data if the drop proves premature. Per policy, a confirmed high-severity finding like this stands on its own and is not diluted by clean reports elsewhere. This should be addressed (e.g., add a backfill/export step and a reversible migration path) before release.

Actual: DO_NOT_APPROVE · Expected: DO_NOT_APPROVE · Deterministic floor: DO_NOT_APPROVE · Passed: true
Latency: 2968 ms · Tokens: 1529 in / 191 out

### `conflicting-signals-01-single-p1-among-clean-reviewers`

Judge summary (verbatim): Code, security, architecture, and test reviewers found no issues. The database reviewer identified a confirmed P1 issue: migration 0051_rename_column.sql renames reviews.legacy_verdict to reviews.verdict with no down-migration or compatibility view, meaning a rollback would break the application by referencing a nonexistent column. This is a real production risk but not a security defect (no access control, auth bypass, or exposed secret), so it does not meet the bar for mandatory DO_NOT_APPROVE. Given the presence of at least one confirmed finding, APPROVE is not appropriate. Recommend addressing the migration reversibility (e.g., add a down-migration or compatibility view) before merging.

Actual: APPROVE_WITH_MINOR_FIXES · Expected: APPROVE_WITH_MINOR_FIXES · Deterministic floor: APPROVE_WITH_MINOR_FIXES · Passed: true
Latency: 7093 ms · Tokens: 1493 in / 616 out

### `duplicate-01-same-root-cause-two-reviewers`

Judge summary (verbatim): A single confirmed root-cause issue was reported by both the code and database reviewers: an N+1 query pattern in getReviewsForRepository (src/server/reviews/repository.ts:44), where findings are fetched in a loop per review instead of a single batched query. This is a high-priority (P1) performance defect, but not a security or access-control issue, so it does not meet the bar for an automatic DO_NOT_APPROVE. Security, architecture, and test reviewers reported no findings. Given at least one confirmed finding exists, approval with minor fixes is warranted — the N+1 query should be addressed before or shortly after release to avoid severe latency at scale.

Actual: APPROVE_WITH_MINOR_FIXES · Expected: APPROVE_WITH_MINOR_FIXES · Deterministic floor: APPROVE_WITH_MINOR_FIXES · Passed: true
Latency: 6113 ms · Tokens: 1636 in / 471 out

### `failed-reviewer-01-required-reviewer-failed`

Judge summary (verbatim): Four of five reviewers (code, security, architecture, database) reported zero findings. However, the test reviewer failed to complete and could not assess the PR's test coverage/domain at all, leaving that area effectively unreviewed. This is a gap in review coverage rather than a confirmed defect, but per policy any incomplete/unknown state should not be treated as a clean pass. Recommend re-running the test reviewer before full approval; no confirmed blockers were identified by the reviewers that did complete.

Actual: APPROVE_WITH_MINOR_FIXES · Expected: DO_NOT_APPROVE · Deterministic floor: APPROVE · Passed: false
Latency: 3602 ms · Tokens: 1383 in / 193 out

### `minor-only-01-nit-and-p2-only`

Judge summary (verbatim): No high-severity or security issues were found. Code and architecture reviewers each reported a single minor issue: a naming-convention nit in totals.ts and a P2 layering concern about a date-formatting helper being placed in the wrong module rather than the shared format utility. Security, database, and test reviewers reported no findings. Given at least one finding exists, policy requires at least minor fixes before approval, but nothing here rises to a blocking severity.”}

Actual: APPROVE_WITH_MINOR_FIXES · Expected: APPROVE_WITH_MINOR_FIXES · Deterministic floor: APPROVE_WITH_MINOR_FIXES · Passed: true
Latency: 7071 ms · Tokens: 1512 in / 278 out

### `mixed-severity-01-realistic-release`

Judge summary (verbatim): A confirmed P1 race condition exists in the webhook idempotency check (ingest.ts:60), allowing duplicate event processing under concurrent deliveries — this is a genuine functional/concurrency defect but not a security-classified issue (security reviewer found no concerns), so it does not meet the bar for automatic DO_NOT_APPROVE. Additionally, a P2 layering violation (webhook handler bypassing the repository layer) and a minor test-naming nit were reported. Database and security reviewers found no issues. Given the presence of a confirmed P1 defect plus additional lower-severity findings, this should not be approved as-is; the race condition should be fixed (e.g., via a unique constraint/atomic upsert) before release, along with addressing the layering concern and test naming.

Actual: APPROVE_WITH_MINOR_FIXES · Expected: APPROVE_WITH_MINOR_FIXES · Deterministic floor: APPROVE_WITH_MINOR_FIXES · Passed: true
Latency: 6009 ms · Tokens: 1643 in / 524 out

## Failure pattern summary

| Failure symptom | Fixture count |
|---|---|
| missed blocker | 1 |
| failed-reviewer gap not recognized by judge | 1 |

