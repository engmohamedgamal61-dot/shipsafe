# Known Limitations (v1.0.0)

Deliberately documented rather than silently accepted. None of these
block a self-hosted v1 release; each is either low-impact, has a safe
fallback, or is a narrow edge case with a clear mitigation.

- **No session-refresh middleware yet.** A long-lived Supabase Auth
  session nearing expiry may not refresh automatically, degrading to an
  unexpected sign-out rather than a security issue. See
  `src/lib/supabase/server.ts`.
- **`completeReview` is not yet one database transaction.** It performs
  three sequential writes (the review row, then reviewer runs, then
  findings). A thrown exception anywhere in that sequence is caught and
  correctly reconciled (the review is marked `failed`), but a full
  process crash between two of those writes — not an exception, an
  actual crash — could in theory leave a review marked `complete` with
  incomplete reviewer_runs/findings. See `src/server/github/writes.ts`.
- **No custom root `error.tsx`.** An unhandled error in a server
  component falls through to Next.js's default error page rather than a
  branded one.
- **Reverse proxies should validate the `Host` header.** The GitHub
  setup callback derives its redirect origin from request headers
  (`x-forwarded-proto`/`Host`); all redirect destinations are hardcoded
  relative paths (no open-redirect today), but a misconfigured proxy
  that forwards an untrusted `Host` header verbatim could spoof that
  origin. Terminate/validate `Host` at your reverse proxy.
- **A multi-repo installation sync aborts remaining repos in that batch
  if one repository hits a cross-workspace ownership conflict.** This is
  the safe side effect of the ownership-protection fix (see the
  Reliability section of `CHANGELOG.md`): rather than silently
  reparenting a repository connected to another workspace, the sync
  throws and stops. Repositories unaffected by the conflict still sync
  individually the next time their own `pull_request` webhook fires.
- **Reviewer residual imprecision exists despite 100% recall on the
  current benchmark suite.** Every specialist reviewer and the Release
  Judge catch 100% of confirmed critical/high-priority defects in their
  respective benchmarks, but precision (false-positive rate) varies by
  reviewer and small, individually-documented gaps remain — see each
  reviewer's `docs/agents/*-baseline-current.md`. The deterministic
  verdict floor means shipped safety never depends on a reviewer being
  flawless, but expect occasional review noise.
