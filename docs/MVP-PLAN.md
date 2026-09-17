# ShipSafe — MVP Plan

## Domain Model (entities)

### Workspace
| field | type | notes |
|---|---|---|
| id | uuid | |
| name | string | |
| slug | string | unique |
| createdBy | uuid | FK → profile |
| createdAt | datetime | |

### WorkspaceMembership
| field | type | notes |
|---|---|---|
| workspaceId | uuid | FK, part of composite PK |
| userId | uuid | FK → profile, part of composite PK |
| role | `'owner' \| 'member'` | no billing/invitations yet |
| createdAt | datetime | |

### Repository
| field | type | notes |
|---|---|---|
| id | uuid | |
| workspaceId | uuid | FK → workspace (not directly to a user — see [ARCHITECTURE.md § Tenancy: Workspaces](./ARCHITECTURE.md#tenancy-workspaces)) |
| provider | `'github' \| 'demo'` | |
| externalId | string \| null | GitHub repo id, null for demo. `unique (provider, externalId)` — repeated webhook delivery can't create duplicates |
| name | string | e.g. `payments-service` |
| fullName | string | e.g. `acme/payments-service` |
| defaultBranch | string | |
| connectedAt | datetime | |

### PullRequest
| field | type | notes |
|---|---|---|
| id | uuid | |
| repositoryId | uuid | FK |
| externalId | string \| null | GitHub PR node id, null for demo |
| number | int | PR number within the repo |
| title | string | |
| sourceBranch | string | |
| targetBranch | string | |
| authorLogin | string | |
| changedFiles | `ChangedFile[]` | jsonb: `{ path, additions, deletions, status }` |
| diffText | text | unified diff, used as review-engine input |
| headSha | string | current known head commit — moves forward as new commits land |
| baseSha | string | current known base commit |
| openedAt | datetime | |

### Review
One **immutable** review of one exact commit — see
[ARCHITECTURE.md § Commit Binding](./ARCHITECTURE.md#commit-binding).

| field | type | notes |
|---|---|---|
| id | uuid | |
| pullRequestId | uuid | FK |
| status | `'pending' \| 'running' \| 'complete' \| 'failed'` | DB `CHECK` enforces completion metadata matches status |
| verdict | `'APPROVE' \| 'APPROVE_WITH_MINOR_FIXES' \| 'DO_NOT_APPROVE' \| null` | null until complete/failed |
| summary | text \| null | Release Judge's written summary |
| failureReason | text \| null | set when `status = 'failed'` — fail-closed explanation |
| reviewedHeadSha | string | pinned at creation, never updated. `unique (pullRequestId, reviewedHeadSha)` |
| reviewedBaseSha | string \| null | pinned at creation |
| ruleVersion | string | which heuristic/prompt rule set produced this review |
| promptVersion | string \| null | set once a real LLM provider is wired up |
| startedAt | datetime \| null | |
| completedAt | datetime \| null | |

### ReviewerRun
| field | type | notes |
|---|---|---|
| id | uuid | |
| reviewId | uuid | FK |
| reviewer | `'code' \| 'security' \| 'architecture' \| 'database' \| 'test' \| 'judge'` | |
| status | `'pending' \| 'running' \| 'complete' \| 'failed'` | |
| summary | text \| null | one-line summary of this reviewer's take |
| errorMessage | text \| null | set when `status = 'failed'` |
| provider / model / requestId / inputTokens / outputTokens / latencyMs / attempt | see `ProviderExecutionMetadata` | execution metadata for future retries/billing — never raw chain-of-thought |
| startedAt | datetime \| null | |
| completedAt | datetime \| null | |

### Finding
| field | type | notes |
|---|---|---|
| id | uuid | |
| reviewerRunId | uuid | FK |
| severity | `'P0' \| 'P1' \| 'P2' \| 'NIT'` | |
| title | string | short summary |
| description | text | full explanation + recommendation |
| filePath | string \| null | |
| lineStart | int \| null | `>= 1` when present |
| lineEnd | int \| null | `>= lineStart` when present |
| category | string | e.g. `sql-injection`, `race-condition`, `missing-test` |

## Database Entities (Postgres/Supabase)

See `supabase/migrations/0001_init.sql` for DDL. Tables map 1:1 to the
entities above, plus `profiles` (mirrors `auth.users`, created via
trigger). All tables have RLS enabled. `pull_requests`, `reviews`,
`reviewer_runs`, and `findings` are **read-only** for authenticated users —
writes go through the service role only. See
[ARCHITECTURE.md § Server-Authoritative Writes & RLS](./ARCHITECTURE.md#server-authoritative-writes--rls).

## Multi-Agent Review Flow

```
                         ┌───────────────────────┐
   ReviewContext ───────▶│  orchestrator.run()    │
   (PR diff + files)     └───────────┬───────────┘
                                      │ fan-out (Promise.all) — a thrown
                                      │ error never rejects this Promise.all;
                                      │ each agent's failure is caught and
                                      │ turned into a "failed" ReviewerRun
              ┌───────────┬──────────┼──────────┬───────────┐
              ▼           ▼          ▼          ▼           ▼
           Code       Security  Architecture Database     Test
          Reviewer    Reviewer   Reviewer    Reviewer    Reviewer
         (required)  (required)  (required)  (required) (required)
              │           │          │          │           │
              └───────────┴────┬─────┴──────────┴───────────┘
                                ▼
                    ReviewerRun[] (status + findings) from all 5 agents
                                │
                                ▼
             orchestrator.run(): checkRequiredReviewers(runs) — IN THE
             ORCHESTRATOR, not the judge
                                │
              ┌─────────────────┴──────────────────┐
              │ blocked (a required run isn't        │
              │ "complete")                           │      not blocked
              ▼                                        ▼
   verdict = DO_NOT_APPROVE                 ┌──────────────────────────┐
   status  = failed                          │ Release Judge            │
   judge run status = "pending"              │ (ReleaseJudgePort) —      │
   — the judge is NEVER CALLED               │ suggests a verdict from   │
                                              │ the findings              │
                                              └────────────┬─────────────┘
                                                            ▼
                                          orchestrator clamps the judge's
                                          suggestion: verdict =
                                          applyVerdictFloor(findings,
                                          judgeVerdict) — can only get
                                          stricter, never more lenient
              │                                            │
              └─────────────────────┬──────────────────────┘
                                     ▼
                Verdict + summary (+ failureReason if blocked/judge failed)
                                     │
                                     ▼
      returned as OrchestratorResult; caller persists Review,
      ReviewerRun×6 (with provider metadata), Finding×N via the
      service-role write path (see ARCHITECTURE.md)
```

Each specialist agent is independent and side-effect free (pure function
of `ReviewContext` → `Finding[]`); the orchestrator owns sequencing,
retries, and both fail-closed checks above — a `ReleaseJudgePort`
implementation is treated as an untrusted suggestion, never as the final
verdict. Retries (one retry for a `ProviderError{kind:"retryable"}`, none
for `"terminal"`) use the same `withRetry()` helper for both the five
reviewers and the judge call — see
[ARCHITECTURE.md § Fail-Closed Review Execution](./ARCHITECTURE.md#fail-closed-review-execution)
for the full reasoning and the adversarial tests that prove it.

## Implementation Phases

### Phase 1 — MVP
1. Docs (this set) + project scaffold
2. Domain layer (`src/domain`) — types, Zod schemas, pure verdict logic + tests
3. Environment validation + demo/configured mode switch
4. Review engine — 6 agents + mock AI provider + orchestrator + tests
5. Demo seed data — one realistic demo PR with a deliberately planted mix
   of P0/P1/P2/Nit issues so the heuristics have something real to find
6. Persistence ports — in-memory adapter (used in demo mode) +
   Supabase adapter (used in configured mode) + SQL migration
7. Auth — demo auth adapter + Supabase auth adapter behind one `AuthPort`
8. Landing page
9. Dashboard (repository/review list)
10. PR review detail screen
11. Verification: lint, typecheck, unit tests, production build

### Phase 1.1 — Release-readiness hardening (this pass)

Added after an external review of Phase 1 found three release-blocking
gaps and several pieces of structural debt worth fixing before Phase 2
integrations land on top of them:

1. **Fail-closed orchestration** — a required reviewer (or the Release
   Judge itself) failing can no longer produce `APPROVE`; it always
   yields `status: "failed"` + `verdict: "DO_NOT_APPROVE"`. See
   [ARCHITECTURE.md § Fail-Closed Review Execution](./ARCHITECTURE.md#fail-closed-review-execution).
2. **Server-authoritative writes** — `pull_requests`/`reviews`/
   `reviewer_runs`/`findings` are read-only under RLS for authenticated
   users; all writes require the service role. See
   [ARCHITECTURE.md § Server-Authoritative Writes & RLS](./ARCHITECTURE.md#server-authoritative-writes--rls).
3. **Commit binding** — every `Review` pins an immutable
   `reviewedHeadSha`; a new commit always gets a new review row, never a
   mutated one. See
   [ARCHITECTURE.md § Commit Binding](./ARCHITECTURE.md#commit-binding).
4. **Workspace/team tenancy** — `Repository` now belongs to a
   `Workspace` via `WorkspaceMembership`, not directly to a `profile`, so
   Phase 2's GitHub installations have a tenant to attach to. See
   [ARCHITECTURE.md § Tenancy: Workspaces](./ARCHITECTURE.md#tenancy-workspaces).
5. **External repository identity** — `repositories.(provider,
   external_repository_id)` is unique, so repeated webhook delivery can't
   create duplicate repository rows.
6. **Review state integrity** — DB `CHECK` constraints make invalid
   status/completion-metadata combinations unrepresentable, not just
   application-discipline.
7. **AI provider execution metadata + `ReleaseJudgePort`** — `AIProvider`
   now returns `{ output, metadata }`; the Release Judge has its own port
   instead of a dead branch inside `AIProvider`. See
   [ARCHITECTURE.md § AI Provider abstraction](./ARCHITECTURE.md#ai-provider-abstraction).
8. **RLS integration tests against real Postgres** — see
   [ARCHITECTURE.md § RLS Integration Tests](./ARCHITECTURE.md#rls-integration-tests).
   This is what caught the `workspace_memberships` infinite-recursion bug
   during development, not a later production incident.

See [ARCHITECTURE.md § Known Gaps](./ARCHITECTURE.md#known-gaps-tracked-not-silently-ignored)
for what was deliberately **not** done in this pass (session refresh,
full adapter-boundary Zod validation, review input hardening, broader
test coverage) and why each is safe to defer.

### Phase 2

1. **Real GitHub App** — webhook ingestion, installation flow, fetching
   real diffs via the GitHub API — writes through the service-role path
   established in Phase 1.1. **Built.** See
   [GITHUB_INTEGRATION.md](./GITHUB_INTEGRATION.md) and
   [ARCHITECTURE.md § GitHub Integration](./ARCHITECTURE.md#github-integration).
   Still uses the same heuristic `MockAIProvider` / `MockReleaseJudgeProvider`
   as Phase 1 — see the next item.

### Phase 2, remaining (not built yet)
- `AnthropicProvider` / `AnthropicJudgeProvider` — real LLM-backed agents
  implementing the same `AIProvider` / `ReleaseJudgePort` interfaces,
  replacing/augmenting the heuristic mock implementations
- GitHub PR inline comments + a status check that can gate merge, keyed
  strictly off `reviewed_head_sha`
- "Fix with AI": generate a repair branch from findings, re-run review
  (as a new `Review` row against the new head SHA)
- Background job runner for long-running reviews (queue instead of
  request/response)
- Billing, workspace invitations (the `workspace_memberships` role model
  from Phase 1.1 is what this builds on)
- E2E test suite (Playwright) once UI stabilizes
- The deferred hardening items in
  [ARCHITECTURE.md § Known Gaps](./ARCHITECTURE.md#known-gaps-tracked-not-silently-ignored)
