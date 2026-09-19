# Changelog

All notable changes to this project are documented in this file.

The format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Version numbers follow [Semantic Versioning](https://semver.org/).

## [1.0.0] — 2026-09-19

First stable release. See
[`docs/RELEASE_NOTES_v1.0.0.md`](docs/RELEASE_NOTES_v1.0.0.md) for a full
narrative tour.

### Added
- Self-registered GitHub App integration: installation flow, webhook
  ingestion (`installation`, `installation_repositories`, `pull_request`),
  and an immediate full repository sync on install.
- Commit-SHA-bound reviews: every review is bound to an exact
  `(pull_request, head_sha)` pair; a new commit always produces a new
  review, never a mutated one.
- Durable, async review queue: the webhook handler validates and
  enqueues only, so it always responds in well under a second; a
  background worker processes queued reviews.
- Six-agent AI review system: Security, Code, Database, Architecture,
  and Test Reviewers, plus a Release Judge that consolidates their
  findings into a final verdict.
- Dashboard and review detail page showing PR opened/last-reviewed
  timestamps, provider/model/latency metadata, per-finding
  severity/confidence/recommendation, and diff/changed-file truncation
  warnings.
- `AI_PROVIDER=mock` (default) vs. `anthropic` provider abstraction —
  ShipSafe runs fully in-memory with zero configuration via demo mode.
- `docs/RELEASE_NOTES_v1.0.0.md`, `docs/KNOWN_LIMITATIONS.md`, and this
  changelog.

### Security
- Webhook HMAC (`X-Hub-Signature-256`) verification with a
  constant-time comparison on every delivery, before any payload is
  parsed or trusted.
- Cross-workspace repository ownership protection: connecting a
  repository can never silently reparent an existing repository (and
  its review history) from one workspace to another; a conflicting
  claim is rejected with a controlled error instead
  (`RepositoryWorkspaceConflictError`).
- Supabase Row-Level Security policies for full tenant isolation,
  verified against a real disposable Postgres instance
  (`npm run test:rls`) rather than application-layer checks alone.
- Prompt-injection resistance: untrusted PR/reviewer content is wrapped
  in explicit delimiters and framed as data, never instructions, in
  every AI system prompt.

### Reliability
- Fail-closed required-reviewer behavior: a required specialist or the
  Release Judge failing to complete can never produce an approval —
  checked before the judge is even invoked.
- Deterministic verdict floor computed directly from findings; a
  judge's own verdict can be more conservative, never more lenient.
- Structured Anthropic output validation, with malformed/missing
  responses treated as provider failures rather than coerced.
- Bounded retry with retryable/terminal error classification for AI
  provider calls (rate limits, 5xx, connection errors retry once;
  terminal errors fail immediately).
- Bounded, exponential-backoff retry for transient GitHub REST API
  failures (429, 5xx, network errors), honoring `Retry-After` when
  present; terminal 4xx responses never retry.
- Webhook retry-safe deduplication: a delivery is only permanently
  deduplicated after it's *successfully* processed. A delivery whose
  processing failed stays retryable under the same delivery id instead
  of being silently dropped; a genuinely concurrent duplicate delivery
  is still recognized and skipped.
- All five specialist reviewers and the Release Judge live-benchmarked
  against real Anthropic API calls, achieving 100% recall (and 100%
  P0/P1 recall) on their respective independently-scored benchmark
  suites — see `docs/agents/*-baseline-current.md`.

### Documentation
- README, `docs/GITHUB_INTEGRATION.md`, and `docs/MVP-PLAN.md` reviewed
  and corrected for v1.0.0 accuracy (stale "not built yet" references
  to the now-shipped durable review queue and webhook retry behavior
  updated to reflect current behavior).
- Release version referenced in the README; release notes, known
  limitations, and this changelog added and cross-linked.

### Known limitations
- No session-refresh middleware yet (degrades to unexpected sign-outs,
  not a security issue).
- `completeReview` is not yet one database transaction (narrow window:
  only a full process crash, not a thrown exception, could leave a
  review incompletely persisted).
- No custom root `error.tsx` (falls back to Next.js's default error
  page).
- Reverse proxies should validate the `Host` header (no exploitable
  open-redirect today; a misconfigured proxy forwarding an untrusted
  `Host` header could spoof a redirect origin).
- A multi-repo installation sync aborts remaining repos in that batch
  if one repository hits a cross-workspace ownership conflict (the safe
  side effect of the ownership-protection fix above).
- Reviewer residual imprecision exists despite 100% recall on the
  current benchmark suite — see `docs/KNOWN_LIMITATIONS.md` and each
  reviewer's baseline doc.

See [`docs/KNOWN_LIMITATIONS.md`](docs/KNOWN_LIMITATIONS.md) for the
complete, current list.
