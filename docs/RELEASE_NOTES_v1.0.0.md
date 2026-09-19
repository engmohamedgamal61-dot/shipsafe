# ShipSafe v1.0.0 — Release Notes

ShipSafe is a self-hosted AI release gate for GitHub pull requests: on
every `opened`/`reopened`/`synchronize` event, five specialist AI
reviewers and a Release Judge evaluate the real diff and produce a
verdict — **Approve**, **Approve with minor fixes**, or **Do not
approve** — bound to the exact commit SHA and shown on a dashboard.

This is the first stable release. See [`CHANGELOG.md`](../CHANGELOG.md)
for a categorized diff of what changed; this document is a narrative
tour of what v1.0.0 actually does.

## Core product

- **GitHub App integration** — self-registered per deployment (no
  shared "ShipSafe" App); installation, webhook delivery, and repo sync
  all flow through it. See [`docs/GITHUB_INTEGRATION.md`](GITHUB_INTEGRATION.md).
- **PR ingestion** — `opened`, `reopened`, and `synchronize` events fetch
  the real diff and changed-file list via the GitHub API and enqueue a
  review; the webhook handler itself only validates and enqueues, so it
  always responds in well under a second regardless of how long the AI
  pipeline takes.
- **Commit-SHA-bound reviews** — every review is bound to the exact
  `(pull_request, head_sha)` pair it was computed against. A new commit
  always produces a new review row; an existing commit's review is never
  silently overwritten or re-run.
- **Dashboard and review detail page** — a review list plus a per-review
  detail view showing every specialist's run, its findings, and the
  final verdict.
- **PR opened / last-reviewed timestamps** shown on both the list and
  detail views.
- **Provider/model/latency metadata** — every reviewer run persists
  which provider and model produced it, how long it took, and (for the
  Anthropic path) token usage — visible on the review detail page.
- **Findings with severity, confidence, and recommendation** — every
  finding carries a `P0`–`Nit` severity, a 0–1 confidence score, and a
  concrete recommendation, not just a description of the problem.
- **Truncation warnings** — a diff or changed-file list that exceeded
  ingest limits is flagged (`diffTruncated`/`changedFilesTruncated`) and
  surfaced in the UI, so a truncated review is never presented as if it
  saw the whole change.

## AI review system

Six agents run on every review: **Security**, **Code**, **Database**,
**Architecture**, and **Test** Reviewers, plus a **Release Judge** that
consolidates their findings into a final verdict. Each specialist stays
in its own lane (a Test Reviewer finding about a missing test is not a
Code Reviewer finding about a production bug, and vice versa), and the
judge reasons only over the five reviewers' own structured
findings/summaries — never the raw diff, and never inventing a finding
that wasn't actually reported.

## Safety and reliability

- **Fail-closed required-reviewer behavior** — if any required
  specialist (or the judge itself) doesn't complete successfully, the
  verdict can never default to approval; it's `DO_NOT_APPROVE` by
  construction, checked before the judge is even invoked.
- **Deterministic verdict floor** — a judge's own verdict is clamped to
  a floor computed directly from the findings (any P0 forces
  `DO_NOT_APPROVE`; any finding at all forces at least
  `APPROVE_WITH_MINOR_FIXES`). The judge can be more conservative than
  the floor, never more lenient.
- **Structured Anthropic output validation** — every AI response is
  parsed against a strict schema; a malformed or missing response is
  treated as a provider failure, never silently coerced.
- **Retry and error classification** — transient provider errors
  (rate limits, 5xx, connection failures) get one bounded retry;
  terminal errors (bad auth, malformed request) fail immediately rather
  than retrying something that can't succeed.
- **Prompt-injection resistance** — untrusted PR content (diff text,
  reviewer findings fed to the judge) is wrapped in explicit delimiters
  and framed as data, never instructions, in every system prompt.
- **Webhook HMAC verification** — every GitHub webhook delivery's
  signature is verified with a constant-time comparison before any
  payload is trusted.
- **GitHub REST retry/backoff** — transient GitHub API failures (429,
  5xx, network errors) get bounded, exponential-backoff retries
  (honoring `Retry-After` when GitHub sends one); a terminal 4xx never
  retries.
- **Webhook retry-safe deduplication** — a delivery is only permanently
  deduplicated once it's *successfully* processed. A delivery whose
  processing failed stays retryable under the same delivery id instead
  of being silently dropped, while a genuinely concurrent duplicate is
  still recognized and skipped.
- **Cross-workspace repository ownership protection** — connecting a
  repository can never silently reparent an existing repository (and
  its review history) from one workspace to another; a conflicting
  claim is rejected with a controlled error instead.
- **Supabase RLS tenant isolation** — every table a signed-in user can
  read is protected by real Postgres row-level security policies,
  verified against a live disposable Postgres instance
  (`npm run test:rls`), not just application-layer checks.

## Self-hosting

- **Local Supabase support** — the full stack (Postgres, Auth, RLS) runs
  locally via the Supabase CLI; no hosted account required for local
  development.
- **Self-registered GitHub App** — step-by-step setup in
  [`docs/GITHUB_INTEGRATION.md`](GITHUB_INTEGRATION.md).
- **Anthropic API configuration** — optional; omit it and ShipSafe runs
  end-to-end on a deterministic mock review engine, useful for
  evaluating the pipeline without spending API credits.
- **`.env.example`** — documents every environment variable the app
  reads, kept in sync with the runtime schema (`src/lib/env.ts`).
- **Migration workflow** — `supabase migration up` applies
  `supabase/migrations/0001`–`0006` in order.
- **Tunnel/webhook setup** — documented for `cloudflared`/`ngrok`-style
  local tunnels, since GitHub needs an HTTPS URL to deliver webhooks to.
- See [`docs/FRESH_INSTALL_CHECKLIST.md`](FRESH_INSTALL_CHECKLIST.md) for
  a condensed, checkbox version of the full setup flow.

## Benchmarking

All five specialist reviewers and the Release Judge were **live
benchmarked against real Anthropic API calls** (not just unit-tested)
using independently-scored, fixture-based benchmark suites — see
[`docs/agents/security-baseline-current.md`](agents/security-baseline-current.md),
[`code-baseline-current.md`](agents/code-baseline-current.md),
[`database-baseline-current.md`](agents/database-baseline-current.md),
[`architecture-baseline-current.md`](agents/architecture-baseline-current.md),
[`test-reviewer-baseline-current.md`](agents/test-reviewer-baseline-current.md),
and [`release-judge-baseline-current.md`](agents/release-judge-baseline-current.md).

Every reviewer achieves **100% recall (and 100% P0/P1 recall)** on its
benchmark suite — no confirmed critical or high-priority defect went
undetected in any benchmark run. Precision varies by reviewer (from
~67% to 100%) and small, individually-documented residual imprecisions
remain (see each linked baseline doc's own failure analysis). This is
**not a claim of perfection**: benchmark suites are necessarily finite,
and the deterministic verdict floor exists precisely so that shipped
review quality never depends on an LLM being flawless — a false
positive costs review noise, but a real defect is protected against by
recall, not precision alone.

## Known limitations

See [`docs/KNOWN_LIMITATIONS.md`](KNOWN_LIMITATIONS.md) for the full
list, current as of this release.
