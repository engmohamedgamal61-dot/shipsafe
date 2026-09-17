# ShipSafe — Architecture

## Stack

- **Next.js 16** (App Router, TypeScript strict, Turbopack)
- **Tailwind CSS v4**
- **Supabase** (Postgres + Auth) as the persistence/auth backend
- **Zod** for all boundary validation (env, forms, server action input, AI
  provider output)
- **Vitest** for domain-logic unit tests, plus a Docker-based RLS
  integration suite (see [RLS Integration Tests](#rls-integration-tests))

No microservices, no message queue, no separate backend process. The
Next.js server (Route Handlers + Server Actions) *is* the backend for the
MVP. The architecture is layered so a future worker process (e.g. for long
running real-GitHub-webhook review jobs) can be extracted without a
rewrite — see [Ports & Adapters](#ports--adapters-why) below.

## Guiding principle: Ports & Adapters

Every external dependency (database, auth, AI provider, GitHub) is
accessed through an interface ("port") defined in `src/server/**/ports.ts`
or alongside the port's own module. Concrete implementations ("adapters")
live next to the port:

- a **Supabase adapter** for real persistence/auth
- a **mock/in-memory adapter** for local development and the demo flow

This is not speculative abstraction — it is required by the MVP itself:
task 9 ("mock/demo PR review that works end-to-end before real GitHub
integration") only makes sense if the review engine and the data layer
don't know or care whether they're talking to Supabase or to an in-memory
fixture. The same interface that powers the demo today powers the real
GitHub App integration in Phase 2 — no throwaway code.

Demo/configured mode (see [Environment & Demo Mode](#environment--demo-mode))
picks the adapter at the composition root (`src/server/container.ts`).
Nothing above that root ever branches on which mode is active.

## Environment & Demo Mode

`src/lib/env.ts` validates `process.env` with Zod once, at import time,
and exports a typed `env` object. Two modes:

- **Configured mode** — `NEXT_PUBLIC_SUPABASE_URL` and
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` (+ `SUPABASE_SERVICE_ROLE_KEY` for server
  writes) are set. Auth and persistence go through real Supabase.
- **Demo mode** (default when Supabase env vars are absent) — the app runs
  fully in-memory: a single demo user, a seeded demo workspace/repository,
  and a seeded demo PR review with real findings produced by the real
  review engine. This is what makes `npm run build` / `npm run dev` work
  with zero configuration, and what task 9 of the MVP requires.

Demo mode is a first-class, intentional adapter selection — not a
try/catch fallback. It is visible in the UI via a small "Demo Mode" badge
so nobody mistakes seeded data for a real connected account.

## Domain Model

Defined once in `src/domain/` (framework-free, no Next.js or Supabase
imports) and consumed everywhere else. See `docs/MVP-PLAN.md` for the full
entity list. Core types:

- `Workspace` / `WorkspaceMembership` (tenancy — see
  [Tenancy: Workspaces](#tenancy-workspaces))
- `Repository` (belongs to a `Workspace`, not directly to a user)
- `PullRequest` (tracks the PR's current `headSha`/`baseSha`)
- `Review` (one **immutable** review of one exact commit — see
  [Commit Binding](#commit-binding))
- `ReviewerRun` (one specialized reviewer's execution within a `Review`,
  including provider execution metadata)
- `Finding` (a single issue, owned by a `ReviewerRun`)
- `Verdict` (`APPROVE` | `APPROVE_WITH_MINOR_FIXES` | `DO_NOT_APPROVE`)
- `Severity` (`P0` | `P1` | `P2` | `NIT`)
- `ProviderExecutionMetadata` (provider/model/tokens/latency/attempt —
  never raw chain-of-thought)

## Multi-Agent Review Engine

Location: `src/server/review-engine/`.

```
review-engine/
  types.ts               shared engine types (ReviewContext, ReviewAgent, DiffReviewerKind)
  diff.ts                 unified-diff parser (file/line attribution for findings)
  version.ts              REVIEW_RULE_VERSION
  agents/
    code-reviewer.ts
    security-reviewer.ts
    architecture-reviewer.ts
    database-reviewer.ts
    test-reviewer.ts
    release-judge.ts       thin wrapper over ReleaseJudgePort (see below)
  providers/
    provider.ts             AIProvider port + ProviderError (retryable/terminal)
    mock-provider.ts         deterministic heuristic-based AIProvider (used today)
    judge-provider.ts        ReleaseJudgePort + MockReleaseJudgeProvider
    anthropic-provider.ts    real Claude-backed adapter (Phase 2, not yet built)
  orchestrator.ts           runs the 5 specialist agents, then the judge; fail-closed
```

### Flow

1. `orchestrator.run(context: ReviewContext)` is given a PR's diff,
   changed files, and metadata.
2. The five specialist agents run **concurrently** (`Promise.all`), each
   receiving the same `ReviewContext` and returning `Finding[]` plus a
   pass/fail-style summary for its domain. `runAgent` never lets an
   agent's rejection propagate — every failure (thrown or otherwise) is
   caught and turned into a `status: "failed"` `ReviewerRun`, so one
   reviewer failing can never short-circuit the others.
3. Each agent is a thin, typed wrapper around an `AIProvider`: it builds a
   domain-specific prompt/heuristic, asks the provider to analyze the
   diff, and validates the provider's output against a Zod schema before
   it's allowed to become a `Finding`.
4. **If every required specialist reviewer succeeded**, the **Release
   Judge** (`ReleaseJudgeAgent` → `ReleaseJudgePort`) receives every other
   agent's `ReviewerRun`s (not the raw diff) and suggests a verdict +
   summary. The orchestrator then clamps that suggestion to the
   deterministic floor computed from the findings before trusting it — the
   judge's output is never the final word by itself. **If any required
   reviewer did not succeed, the judge is never called at all**, and the
   orchestrator sets the fail-closed default directly. See
   [Fail-Closed Review Execution](#fail-closed-review-execution) for
   exactly how this is decided — it happens in the orchestrator, not
   inside the judge.
5. The orchestrator returns an `OrchestratorResult`; the caller (e.g.
   `src/server/demo/seed.ts`, and the Phase 2 ingestion service) is
   responsible for persisting it as a `Review` + `ReviewerRun` rows
   through the trusted-backend write path — see
   [Server-Authoritative Writes](#server-authoritative-writes--rls).

### AI Provider abstraction

`AIProvider` is a single-method port over the five **diff-reviewing**
agents only (`DiffReviewerKind = Exclude<ReviewerKind, "judge">`):

```ts
interface AIProvider {
  review(input: AgentReviewInput): Promise<AgentReviewResult> // { output, metadata }
}
```

Today, `MockAIProvider` implements this with real static-analysis-style
heuristics over the diff text (pattern matching for things like
`SELECT *` in migrations, empty `catch` blocks, hardcoded secrets, `ALTER
TABLE ... DROP`, missing test files for changed source files, etc.) — this
is a genuine rule engine, not a hardcoded fixture, so the demo review is
computed from whatever `ReviewContext` it's given.

Phase 2 swaps in `AnthropicProvider`, which sends the same
`AgentReviewInput` to the Claude API and validates the structured response
against the same output schema. No agent, orchestrator, or UI code changes
when that swap happens — this is the reason the provider boundary exists.

Every call returns `AgentReviewResult { output, metadata }`, where
`metadata: ProviderExecutionMetadata` captures `provider`, `model`,
`requestId`, `inputTokens`, `outputTokens`, `latencyMs`, and `attempt`.
This is persisted per `ReviewerRun` so retries and cost are attributable
later — see the `reviewer_runs` columns in
[Database Schema](#database-schema-supabasepostgres). It deliberately
never includes raw model chain-of-thought.

### Provider error classification & retries

`ProviderError` (thrown by an `AIProvider` or `ReleaseJudgePort`
implementation) carries a `kind: "retryable" | "terminal"`:

- **retryable** — transient: timeouts, rate limits, network errors, a 5xx
  from the provider. Retried **once**.
- **terminal** — will not succeed on retry: invalid input, a schema the
  provider can't satisfy, an auth failure. Failed immediately, no retry
  wasted.
- Any thrown value that isn't a `ProviderError` (a bug, an unexpected
  throw) is treated as **terminal** — never retried, because there's
  nothing to say it would behave differently on a second attempt.

This policy is implemented **once**, in
`ReviewOrchestrator.withRetry()`, and applies identically to the five
specialist reviewers (`runAgent`) and to the Release Judge call in
`run()` — both call `withRetry(label, (attempt) => ...)` rather than each
having their own retry loop. A transient judge failure gets exactly the
same one-retry treatment as a transient reviewer failure; there is no
second, differently-tuned retry policy to keep in sync.

### The Release Judge is not a diff reviewer, and its output is never trusted outright

`ReleaseJudgePort` (`providers/judge-provider.ts`) is a **separate port**
from `AIProvider` — it takes the other agents' `ReviewerRun`s, not a diff,
and returns a verdict/summary. Earlier drafts of this engine forced the
judge through `AIProvider`'s `review()` method with a dead
`case "judge":` branch that returned empty findings; that's gone.
`ReleaseJudgeAgent` is now a thin wrapper over `ReleaseJudgePort`, kept as
its own class purely so the orchestrator's dependency list reads
symmetrically with the five specialist agents.

Just as importantly: **the orchestrator does not trust whatever this port
returns.** See [Fail-Closed Review Execution](#fail-closed-review-execution)
— a `ReleaseJudgePort` implementation only ever gets to *suggest* a
verdict; the orchestrator decides whether it gets asked at all, and clamps
its answer afterward.

## Fail-Closed Review Execution

**A required reviewer's failure must never be indistinguishable from "found
nothing," and a lenient judge must never be able to override that.** Both
halves of this are enforced in `ReviewOrchestrator.run()` itself — not
inside a `ReleaseJudgePort` implementation, which is untrusted input as
far as the verdict is concerned:

**1. Before the judge is ever called** — `checkRequiredReviewers`
(`domain/verdict.ts`) runs against the specialist `ReviewerRun`s:

```ts
export const REQUIRED_REVIEWERS = ["code", "security", "architecture", "database", "test"];

export function checkRequiredReviewers(runs, required = REQUIRED_REVIEWERS):
  | { blocked: true; failureReason: string }
  | { blocked: false; failureReason: null }
```

If any required reviewer's `ReviewerRun` isn't `status: "complete"`
(crashed, timed out, or is simply missing), the orchestrator sets
`status: "failed"`, `verdict: "DO_NOT_APPROVE"`, and a `failureReason`
naming the reviewer(s) — **and never calls the judge at all.** The judge's
own `ReviewerRun` entry gets `status: "pending"` (it genuinely never
started) with a summary explaining it was skipped. This means an
adversarial or simply buggy judge implementation that always returns
`APPROVE` has no opportunity to matter here, because it is never invoked
— see `orchestrator.test.ts`'s "never calls the judge ... even if the
judge would always say APPROVE" test.

**2. After a successful judge call** — the judge's verdict is passed
through the deterministic floor before being trusted:

```ts
const allFindings = reviewerRuns.flatMap((run) => run.findings);
verdict = applyVerdictFloor(allFindings, outcome.value.output.verdict);
```

`applyVerdictFloor` can only make the verdict *stricter* than what the
judge said, never more lenient (see
[Multi-Agent Review Flow](./MVP-PLAN.md#multi-agent-review-flow) in
MVP-PLAN.md for the floor rules themselves). A judge that returns
`APPROVE` in the face of a P0 finding is silently corrected to
`DO_NOT_APPROVE`, not trusted — see `orchestrator.test.ts`'s "clamps an
always-APPROVE judge to the deterministic floor" test.

**3. If the judge call fails** (after retries — see
[Provider error classification & retries](#provider-error-classification--retries))
— the same fail-closed default applies directly: `status: "failed"`,
`verdict: "DO_NOT_APPROVE"`, `failureReason` explaining the judge itself
failed.

There is no code path in `ReviewOrchestrator.run()` that returns
`status: "complete"` with a verdict more lenient than either of these two
independent checks allows — and no code path that reaches `"complete"`
without a judge having actually evaluated the run.

All five specialist reviewers are required in Phase 1 — there is no
product reason yet to ship a verdict that's missing one of them. There is
no "optional reviewer" concept yet; `REQUIRED_REVIEWERS` would be the
place to introduce one.

Covered by:
- `src/domain/verdict.test.ts` — `checkRequiredReviewers` unit tests (one
  reviewer fails, multiple fail, all fail, a run is missing entirely, the
  judge's own failure doesn't count as a "required reviewer").
- `src/server/review-engine/providers/judge-provider.test.ts` — proves the
  provider does *not* fail-close on its own (by design — see the port's
  doc comment), which is exactly why the orchestrator-level check exists.
- `src/server/review-engine/orchestrator.test.ts` — the two adversarial
  `AlwaysApprovesJudgeProvider` tests described above, plus the required-
  reviewer-failure and judge-failure scenarios end to end.
- `src/server/review-engine/orchestrator.test.ts` — end-to-end
  orchestration: a reviewer throwing after others succeed, retry
  behavior for retryable vs. terminal `ProviderError`s, and "a failed run
  can never result in APPROVE."

## Server-Authoritative Writes & RLS

`pull_requests`, `reviews`, `reviewer_runs`, and `findings` are
**authoritative, computed data** — nothing a client should ever be able to
mutate directly, regardless of who owns the workspace. Postgres Row Level
Security enforces this at the database layer, not just in application
code:

- Workspace members get a `SELECT` policy on all four tables (scoped
  through `workspace_memberships` — see
  [Tenancy: Workspaces](#tenancy-workspaces)).
- There is **no** `INSERT`/`UPDATE`/`DELETE` policy for the `authenticated`
  role on any of the four. Postgres RLS defaults to deny when no policy
  covers a command, so an authenticated user's `UPDATE`/`DELETE` silently
  affects 0 rows, and their `INSERT` is rejected with
  `new row violates row-level security policy` (SQLSTATE `42501`).
- `repositories` (and `workspaces`/`workspace_memberships`) are **normal
  user-managed metadata** — which repos a workspace has connected. Owners
  keep full read/write there via a separate policy; this is intentionally
  not locked down the same way.
- All writes to the four authoritative tables happen through
  `src/lib/supabase/service.ts` (`createServiceSupabaseClient`), which
  uses the Supabase **service role** key. `service_role` has
  `BYPASSRLS`, so it isn't blocked by (and doesn't need) any policy — the
  *code path* using it is what has to enforce correctness (e.g. "this
  review belongs to a PR the caller's workspace owns") before writing.
  `SupabaseReviewRepository` (`src/server/repositories/supabase-adapter.ts`)
  remains read-only; `src/server/github/writes.ts` is the writer, used by
  the GitHub webhook ingestion path — see
  [GitHub Integration](#github-integration) below.

See [RLS Integration Tests](#rls-integration-tests) for how this is
verified against a real Postgres instance, not asserted from application
code alone.

## Commit Binding

A `Review` describes **one exact commit**, immutably:

- `PullRequest.headSha` / `baseSha` track the PR's *current* known
  commits — they move forward as new commits land, the same way GitHub's
  own PR object does.
- `Review.reviewedHeadSha` / `reviewedBaseSha` are set once, at review
  creation, and never updated. A `unique (pull_request_id,
  reviewed_head_sha)` constraint means a new head SHA always requires a
  new `Review` row — there is no code path that updates an existing
  review's verdict in place for a different commit than the one it was
  computed against.
- `Review.ruleVersion` / `promptVersion` record which version of the
  review engine's rules (and, once an LLM provider lands, which prompt)
  produced this review, so a future change to the heuristics/prompts
  doesn't retroactively change what an old review is presented as having
  found.

A future GitHub status check / PR comment integration will key strictly
off `reviewed_head_sha` — a verdict is only ever shown against, or used to
gate, the exact commit it was computed for. (Not yet built — see
`docs/MVP-PLAN.md` Phase 2.)

## Tenancy: Workspaces

Every `Repository` belongs to a `Workspace`, never directly to a user.
Kept intentionally minimal for Phase 1:

- `workspaces` — `id`, `name`, `slug`, `created_by`.
- `workspace_memberships` — `(workspace_id, user_id, role)`, `role` is
  `'owner' | 'member'`. No billing, no invitations yet.
- Creating a workspace atomically makes the creator its `owner` via a
  `SECURITY DEFINER` trigger (`handle_new_workspace`) — there is no
  client-writable "insert your own membership" path, so there's no window
  where a workspace exists with no owner.
- `is_workspace_member(workspace_id, user_id)` /
  `is_workspace_owner(workspace_id, user_id)` are `SECURITY DEFINER` SQL
  functions used by every RLS policy that needs a membership check.
  **This is required, not a style choice**: a policy on
  `workspace_memberships` that queries `workspace_memberships` directly
  (even via `EXISTS`) makes Postgres report `infinite recursion detected
  in policy` — wrapping the check in a `SECURITY DEFINER` function
  evaluates it without re-entering RLS on the same table. (This was
  caught by the live RLS test suite, not by inspection — see below.)

The UI does not yet expose a workspace switcher or invite flow — Phase 1
has exactly one workspace per user (`workspaceIdForUser()` in
`src/server/demo/seed.ts` is the demo-mode equivalent of that 1:1
mapping), so the data model is ahead of the UI here by design: it's the
piece that's expensive to retrofit later, unlike a switcher.

## GitHub Integration

Real GitHub App installation, webhook ingestion, and PR diff fetching are
implemented in `src/server/github/` — see
[GITHUB_INTEGRATION.md](./GITHUB_INTEGRATION.md) for the self-hosting
setup guide (registering a GitHub App, required env vars, local dev via a
tunnel) and how the install/webhook flow works end to end. It's gated
behind `isGitHubConfigured` (`src/lib/env.ts`): every self-hoster brings
their own GitHub App, so a fresh checkout with no GitHub env vars set
still runs fine — the "Connect GitHub" button is disabled with an
explanatory tooltip instead of erroring.

`Repository.externalId` (`external_repository_id` in Postgres) and
`PullRequest.externalId` (`external_pull_request_id`) hold the provider's
stable identity for a repo/PR. `repositories` has a
`unique (provider, external_repository_id)` constraint — Postgres treats
`NULL`s as distinct, so multiple demo repositories (no external id) are
still allowed, but a real `(github, <repo id>)` pair can only ever be
connected once, anywhere, which is what makes repeated webhook delivery
safe to just "upsert" against instead of accumulating duplicate rows.

Not yet built (see `docs/MVP-PLAN.md` Phase 2): GitHub PR inline comments
and a status check that can gate merge, an `AnthropicProvider` replacing
the heuristic mock review engine, and a background job runner (webhook
ingestion currently runs synchronously in the Route Handler).

## Auth

`src/server/auth/` defines an `AuthPort` (`getSession`, `signOut`, …).

- **Configured mode**: `SupabaseAuthAdapter` using `@supabase/ssr` cookie
  based sessions (server components read the session via
  `createServerClient`; a Route Handler-based sign-in/sign-up form posts
  to Supabase Auth).
  - **Known gap**: there is no `src/proxy.ts` (Next.js 16's renamed
    `middleware.ts`) refreshing the Supabase session on every request yet.
    `src/lib/supabase/server.ts`'s cookie `setAll` has a `TODO` marking
    this — without it, a long-lived configured-mode session can expire
    without being transparently refreshed. Add this before configured
    mode is used for anything beyond local testing.
- **Demo mode**: `DemoAuthAdapter` issues a signed, httpOnly demo-session
  cookie for a single seeded demo user. There is no password — the
  landing page's "View Live Demo" button calls a server action that sets
  the cookie and redirects to `/dashboard`. This keeps the *shape* of auth
  (session cookie → server-side `getSession()` → redirect if absent)
  identical between modes, so route protection code never branches on
  mode.

## Database Schema (Supabase/Postgres)

Source of truth: `supabase/migrations/0001_init.sql`. Summary — see
`docs/MVP-PLAN.md` for column-level detail:

- `profiles` — one row per authenticated user (mirrors `auth.users`)
- `workspaces` / `workspace_memberships` — tenancy (see
  [Tenancy: Workspaces](#tenancy-workspaces))
- `repositories` — connected repos, owned by a `workspace`; user-managed
- `pull_requests` — PRs belonging to a repository; authoritative
- `reviews` — one **immutable** review of one exact commit; authoritative
- `reviewer_runs` — one specialist agent's execution within a review,
  including provider execution metadata; authoritative
- `findings` — individual findings, owned by a reviewer run; authoritative

Row Level Security is enabled on every table:
- `profiles`, `workspaces`, `workspace_memberships`, `repositories`:
  members read, owners manage (see
  [Tenancy: Workspaces](#tenancy-workspaces)).
- `pull_requests`, `reviews`, `reviewer_runs`, `findings`: members
  **read-only** — see
  [Server-Authoritative Writes & RLS](#server-authoritative-writes--rls).

**Review state integrity** is enforced with `CHECK` constraints, not just
application discipline:
- `status = 'complete'` requires `verdict IS NOT NULL AND completed_at IS
  NOT NULL`.
- `status = 'failed'` requires `failure_reason IS NOT NULL AND
  completed_at IS NOT NULL`.
- `status IN ('pending', 'running')` requires verdict/completed_at/
  failure_reason to all be `NULL` — an in-progress review can't carry
  stale completion metadata.
- `findings.line_start >= 1` and `line_end >= line_start` when present
  (also enforced by `providerFindingSchema`'s Zod `.refine` at the
  application boundary — belt and suspenders, not redundant, since the
  DB is the last line of defense against any future write path).

## RLS Integration Tests

`supabase/tests/rls.test.sql` + `scripts/test-rls.sh` — a genuine
integration test against a **real** Postgres instance, not a mock: it
runs `public.ecr.aws/supabase/postgres`, the same image `supabase start`
uses locally, which ships the real `auth` schema, the `anon` /
`authenticated` / `service_role` roles, and a real `auth.uid()`. The test
switches role and JWT claim (`SET LOCAL ROLE ...; SET LOCAL
request.jwt.claim.sub = '<uuid>'`) exactly the way PostgREST authenticates
a request, then asserts:

- the workspace owner can read their own reviews/reviewer_runs/findings
- the owner **cannot** modify a review's verdict (0 rows affected)
- the owner **cannot** delete a P0/P1 finding (0 rows affected)
- the owner **cannot** fabricate reviewer success by inserting a fake
  `reviewer_runs` row (rejected with `insufficient_privilege`)
- a user outside the workspace sees nothing (cross-tenant isolation)
- a plain `member` can read but can't manage repositories or membership
  (owner-only actions actually require the owner role)
- the workspace owner *can* still manage repository metadata (confirms
  the lockdown above didn't accidentally over-reach)
- the trusted-backend (`service_role`) path can write results — implicit
  in the fixture setup succeeding at all

The whole script runs as one transaction that is always rolled back, so
it's idempotent and safe to re-run against the same disposable container.
Requires Docker; **not** part of `npm test` — run explicitly:

```
npm run test:rls
```

This test suite is what caught a real bug during development: the first
draft of the `workspace_memberships` RLS policies queried
`workspace_memberships` from within its own policy and Postgres reported
`infinite recursion detected in policy` — fixed by moving the check into
the `SECURITY DEFINER` helper functions described in
[Tenancy: Workspaces](#tenancy-workspaces).

## Folder Structure

```
src/
  app/                          Next.js App Router routes
    (marketing)/                landing page route group
    (auth)/                     sign-in / sign-up route group
    (dashboard)/                authenticated app shell
      dashboard/                repo/review list
      repositories/             repository connection screen
      reviews/[reviewId]/       PR review detail screen
    actions/                    Server Actions (thin — call server/ services)
    api/                        Route Handlers (thin — call server/ services)
    globals.css
    layout.tsx
  components/
    ui/                         generic, reusable primitives (Button, Badge, Card, ...)
    marketing/                  landing-page-only sections
    dashboard/                  dashboard/review-screen presentational components
  domain/                       framework-free types + Zod schemas + pure logic
    types.ts
    schemas.ts
    verdict.ts                  pure verdict-aggregation + fail-closed logic (unit tested)
  server/                       server-only code (never imported from client components)
    container.ts                composition root: picks adapters based on env
    auth/
    repositories/                persistence ports + supabase/in-memory adapters
    review-engine/
    demo/                        demo seed data + demo fixtures
  lib/
    env.ts                       validated environment
    logger.ts                    structured logger
    errors.ts                    AppError hierarchy + ActionResult
    supabase/                    supabase client factories (browser/server/service-role)
    utils.ts
supabase/
  migrations/
  tests/                         RLS integration tests (SQL, run via scripts/test-rls.sh)
scripts/
  test-rls.sh                    provisions a disposable Postgres + runs the RLS suite
docs/
```

## Error Handling & Logging

- `src/lib/logger.ts` exports a small structured logger (`logger.info({...}, msg)`)
  used server-side; no `console.log` scattered through business logic.
- Server Actions and Route Handlers validate input with Zod at the
  boundary and return a typed `{ ok: true, data } | { ok: false, error }`
  result rather than throwing across the server/client boundary.
- Domain errors (e.g. "review not found") are typed (`class
  NotFoundError extends AppError`) so route handlers can map them to the
  right HTTP status instead of leaking stack traces.

## Testing

`vitest` covers the framework-free domain logic and review-engine
orchestration that is worth protecting:

- `src/domain/verdict.test.ts` — verdict aggregation rules (P0 ⇒
  DO_NOT_APPROVE, etc.) and `checkRequiredReviewers` fail-closed cases.
- `src/server/review-engine/providers/mock-provider.test.ts` — each
  heuristic agent against fixture diffs with known-good expected findings.
- `src/server/review-engine/providers/judge-provider.test.ts` — the mock
  judge's own verdict-from-findings logic, including that it deliberately
  does *not* fail-close on its own (see
  [Fail-Closed Review Execution](#fail-closed-review-execution)).
- `src/server/review-engine/orchestrator.test.ts` — end-to-end
  orchestration: required-reviewer failures (single/multiple/all), retry
  policy for retryable vs. terminal `ProviderError`s (applied identically
  to reviewers and the judge), the Release Judge itself failing, and two
  adversarial `AlwaysApprovesJudgeProvider` tests proving the orchestrator
  — not the judge — is what enforces fail-closed behavior and the verdict
  floor.

`supabase/tests/rls.test.sql` (via `npm run test:rls`) covers RLS —
see [RLS Integration Tests](#rls-integration-tests). It needs Docker, so
it's separate from `npm test`.

UI is verified manually (see the report at the end of each implementation
phase) — component/E2E test infra is a Phase 2+ investment once the UI
surface stabilizes.

## Known Gaps (tracked, not silently ignored)

Deliberately deferred out of this pass — flagged here rather than solved
partially:

- **Session refresh** (`src/proxy.ts`) — see [Auth](#auth).
- **Adapter-boundary validation** — `SupabaseReviewRepository`'s mappers
  are explicit and typed against a hand-written `Database` type, but
  don't run malformed rows through a Zod schema before trusting them. Now
  that `src/server/github/writes.ts` populates these tables from real
  GitHub data, this is a live gap, not a hypothetical one — still
  deferred, but should be picked up soon.
- **Review input hardening** — no max diff size / changed-file count /
  binary-patch handling yet in the review engine. Now that the GitHub
  webhook path (`src/server/github/ingest.ts`) feeds it arbitrary real
  PRs, an oversized diff or huge file count from a real repository will
  hit this unhardened path — still deferred, but this is the next thing
  that should land, not indefinitely.
- **Broader test coverage** — diff parser edge cases (multiple hunks,
  deleted files, quoted paths, binary patches), demo-cookie rejection,
  and a configured-auth integration test are not yet written.
