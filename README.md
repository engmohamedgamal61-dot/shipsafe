# ShipSafe

**Know if your code is safe to ship.**

ShipSafe is a self-hosted AI release gate for GitHub pull requests. When a
PR is opened, reopened, or pushed to, ShipSafe runs five specialist AI
reviewers (code, security, architecture, database, test) plus a Release
Judge over the real diff, and produces a verdict — **Approve**, **Approve
with minor fixes**, or **Do not approve** — the way a fast, opinionated
staff engineer would, minus the Slack ping.

It's designed to be **fail-closed**: if a required reviewer or the judge
doesn't complete successfully, the verdict can never silently default to
approval. See [`docs/PRODUCT.md`](docs/PRODUCT.md) for the full product
spec and severity model.

## Architecture at a glance

- **Next.js (App Router)** — UI, auth pages, and two API routes: the
  GitHub webhook receiver and the GitHub App install callback.
- **Supabase (Postgres + Auth + Row-Level Security)** — the only
  datastore. Every table a user can read is protected by RLS; the review
  pipeline writes through a service-role client that bypasses it, kept to
  one module (`src/server/github/writes.ts`).
- **GitHub App** — the only integration. Its webhook deliveries
  (`installation`, `installation_repositories`, `pull_request`) drive
  everything; there is no polling.
- **Durable async review queue** — the webhook handler only validates and
  enqueues a review (a `reviews` row with `status='pending'`) and returns
  in well under a second. A background worker, started once per server
  process from `src/instrumentation.ts`, polls for queued work and runs
  it through the review engine — so a slow AI pipeline can never make a
  GitHub webhook delivery time out.
- **AI provider abstraction** — the five reviewers and the judge run
  against a pluggable `AIProvider`. `AI_PROVIDER=mock` (the default) uses
  a deterministic heuristic engine and needs no API key; `anthropic` uses
  real Claude calls. Swapping one for the other touches no other code.
- **No demo-mode dependency** — with zero configuration ShipSafe runs
  fully in-memory (one seeded demo user, repo, and PR review), so
  `npm install && npm run dev` works before you've touched Supabase or
  GitHub at all.

Deeper reference docs: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) ·
[`docs/GITHUB_INTEGRATION.md`](docs/GITHUB_INTEGRATION.md) ·
[`docs/PRODUCT.md`](docs/PRODUCT.md) · [`docs/MVP-PLAN.md`](docs/MVP-PLAN.md).

For a condensed, checkbox version of everything below, see
[`docs/FRESH_INSTALL_CHECKLIST.md`](docs/FRESH_INSTALL_CHECKLIST.md).

---

## Requirements

| Requirement | Needed for | Notes |
|---|---|---|
| **Node.js ≥ 20.9** | everything | matches Next.js 16's own minimum |
| **npm** | everything | ships with Node |
| **Docker** (Desktop or compatible) | local Supabase, RLS tests | Supabase's local stack and the RLS integration test both run real Postgres in Docker |
| **Supabase CLI** | real auth/persistence | install via `brew install supabase/tap/supabase`, or see [supabase.com/docs/guides/cli](https://supabase.com/docs/guides/local-development/cli/getting-started) for other platforms — no Supabase.com account needed for local dev |
| **A GitHub account** | real GitHub integration | to register your own GitHub App |
| **A GitHub App you register yourself** | real PR ingestion | see [step 7 below](#7-setting-up-the-github-app) — there is no shared "ShipSafe" App |
| **An Anthropic API key** | real AI reviews | optional — omit it and reviews use the deterministic mock engine instead |
| **A tunnel tool** (`cloudflared`, `ngrok`, or equivalent) | receiving real GitHub webhooks locally | GitHub needs an HTTPS URL to deliver to; your laptop on `localhost` isn't reachable from GitHub's servers |

You do **not** need Docker, Supabase, a GitHub App, or an Anthropic key
just to run the app and see a review — see [Quickstart: demo mode](#quickstart-demo-mode).

---

## Quickstart: demo mode

The fastest way to confirm the app runs at all, with zero external
services:

```bash
git clone <this-repo-url>
cd shipsafe
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You'll land on a
seeded demo workspace with one demo repository and one already-completed
PR review, computed by the real review engine (heuristic/mock provider)
against a real fixture diff — not a static screenshot. A "Demo Mode"
badge makes it clear this is seeded data, not a real connected account.

Everything below is for connecting a real GitHub repository and (optionally)
real Claude-backed reviews.

---

## Full setup: real GitHub + AI reviews

### 1. Clone and install

```bash
git clone <this-repo-url>
cd shipsafe
npm install
```

### 2. Create `.env.local`

```bash
cp .env.example .env.local
```

Every variable is documented inline in `.env.example`, and again below in
[Environment variables](#environment-variables). You'll fill in real
values as you go through the steps below — nothing needs to be set all
at once.

### 3. Start local Supabase

```bash
supabase start
```

This boots a local Postgres, Auth, Studio, and API stack in Docker
(`supabase/config.toml` is already committed to this repo, so no
`supabase init` is needed). The command prints an **API URL**, **anon
key**, and **service role key** — copy those into `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=<the printed API URL>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<the printed anon key>
SUPABASE_SERVICE_ROLE_KEY=<the printed service role key>
```

(Lost the output? Run `supabase status` any time to reprint it.)

### 4. Apply migrations

```bash
supabase migration up
```

Applies every file in `supabase/migrations/` in order and records what's
applied in the local database, so re-running this later only applies
anything new (see [Troubleshooting](#pending-migrations)).

### 5. Run the app

```bash
npm run dev
```

[http://localhost:3000](http://localhost:3000) now runs against real
Supabase instead of demo mode. The background review-queue worker starts
automatically in the same process (see [Architecture](#architecture-at-a-glance)) —
there's no separate worker process to start.

### 6. Create an account

Go to [http://localhost:3000/sign-up](http://localhost:3000/sign-up) and
sign up with any email/password — local Supabase has email confirmation
disabled by default, so the account is active immediately. Signing up
automatically creates a personal workspace for you (a database trigger —
see `supabase/migrations/0001_init.sql`).

### 7. Setting up the GitHub App

GitHub integration is entirely self-registered — see
[`docs/GITHUB_INTEGRATION.md`](docs/GITHUB_INTEGRATION.md) for full
detail. Short version:

1. **Start a tunnel first**, so you have the HTTPS URL to register:
   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```
   Note the `https://<random-name>.trycloudflare.com` URL it prints, and
   set it as `SHIPSAFE_TUNNEL_URL` in `.env.local`:
   ```
   SHIPSAFE_TUNNEL_URL=https://<random-name>.trycloudflare.com
   ```
   Next's dev server otherwise rejects the tunnel's cross-origin requests
   (see `next.config.ts`) — without this, pages loaded through the tunnel
   URL fail to hot-reload/fetch assets correctly. Restart `npm run dev`
   after setting it.
2. Go to **github.com/settings/apps/new** and create an app with:
   - **Setup URL**: `https://<your-tunnel-url>/api/github/setup` (check
     "Redirect on update")
   - **Webhook URL**: `https://<your-tunnel-url>/api/webhooks/github`
     — this exact path is the only endpoint that receives GitHub events.
   - **Webhook secret**: generate one (`openssl rand -hex 32`) and keep
     it — this becomes `GITHUB_WEBHOOK_SECRET`.
   - **Repository permissions**: Metadata (read-only), Pull requests
     (read-only), Contents (read-only).
   - **Subscribe to events**: `Installation`, `Installation repositories`,
     `Pull request`.
   - **Where can this be installed**: "Only on this account" is simplest
     while testing.
3. Note the **App ID** and **slug**, and generate/download a **private
   key** (PEM) from the app's settings page.
4. Fill in `.env.local`:
   ```
   GITHUB_APP_ID=<the App ID>
   GITHUB_APP_SLUG=<the app's slug>
   GITHUB_APP_PRIVATE_KEY=<the PEM, see the note in .env.example about \n escaping>
   GITHUB_WEBHOOK_SECRET=<the secret from step 2>
   ```
5. Restart `npm run dev` so the new env vars are picked up.

### 8. (Optional) Enable real AI reviews

Without this, reviews still run end-to-end using the deterministic mock
engine — useful for testing the pipeline without spending API credits.
To use real Claude reviews:

```
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=<your own Anthropic API key>
```

Restart `npm run dev` after changing this.

### 9. Install the GitHub App on a repository

In the running app, go to **Repositories** → **Connect GitHub**. You'll
be redirected to GitHub to pick an account and one or more repositories,
then redirected back — the repos you picked should appear immediately
(an initial sync runs as part of that callback, before any webhook fires).

### 10. Trigger the first PR review

Open a pull request (or push a commit to an existing one) in the
repository you just connected. GitHub delivers a `pull_request` webhook
to your tunnel URL, ShipSafe enqueues a review, and it appears on the
dashboard within a few seconds.

If you don't want to make a real commit, GitHub lets you **redeliver**
any past webhook from the App's **Advanced → Recent Deliveries** tab —
the fastest way to re-trigger ingestion without opening a new PR each
time (though redelivering a commit that's already been reviewed is a
no-op by design — see [Troubleshooting](#duplicate-webhook-delivery)).

---

## Environment variables

Every variable `.env.example` lists, and what it's for. Nothing here
needs to be set for [demo mode](#quickstart-demo-mode); the app runs
fine with `.env.local` absent or empty.

| Variable | Required for | What it is |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | real auth/persistence | Your local (or hosted) Supabase project's API URL. Absent → demo mode. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | real auth/persistence | The project's public anon key (safe to expose to the browser — RLS is what actually protects data). |
| `SUPABASE_SERVICE_ROLE_KEY` | real GitHub ingestion | Bypasses RLS. Used **only** server-side, by the trusted webhook/worker write path. Never expose this to the browser. |
| `APP_SECRET` | always (has a dev default) | Signs the demo-session cookie and the short-lived GitHub-install state token. The `.env.example` default is fine for local dev; set a real random value for any shared deployment. |
| `GITHUB_APP_ID` | real GitHub integration | The numeric App ID from your GitHub App's settings page. |
| `GITHUB_APP_SLUG` | real GitHub integration | The `apps/<slug>` segment of your App's settings URL. |
| `GITHUB_APP_PRIVATE_KEY` | real GitHub integration | The App's PEM private key. Accepts either real newlines or `\n`-escaped ones (most env-var UIs don't allow real newlines). |
| `GITHUB_WEBHOOK_SECRET` | real GitHub integration | The webhook secret you generated when creating the App. Verifies each delivery's signature. |
| `SHIPSAFE_TUNNEL_URL` | local dev via a tunnel | Your tunnel's HTTPS origin (e.g. `https://<name>.trycloudflare.com`). Next's dev server allow-lists it for cross-origin requests — see `next.config.ts`. Unused outside local tunneled development. |
| `AI_PROVIDER` | choosing the review engine | `mock` (default) or `anthropic`. All four GitHub vars above are independent of this — you can ingest real PRs and still review them with the mock engine. |
| `ANTHROPIC_API_KEY` | `AI_PROVIDER=anthropic` | Your own Anthropic API key. Bring your own — there is no shared ShipSafe account. |
| `ANTHROPIC_MODEL` | optional | Defaults to `claude-sonnet-5`. |
| `AI_MAX_TOKENS_PER_REVIEWER` | optional | Per-call output token ceiling. Default `4096`. |
| `AI_REQUEST_TIMEOUT_MS` | optional | Per-call timeout. Default `30000`. |
| `AI_MAX_CONCURRENT_REVIEWERS` | optional | Caps concurrent Anthropic calls across the whole process. Default `3`. |

All four `GITHUB_*` vars must be set **together** to activate GitHub
integration, and it additionally requires Supabase to be configured —
see `isGitHubConfigured` in `src/lib/env.ts` if you want the exact logic.

---

## What Queued / Analyzing / Complete / Failed mean

Every review moves through the same lifecycle, shown on both the
dashboard list and the review detail page:

- **Queued** — the webhook was received and validated; the review is
  durably persisted and waiting for the background worker to pick it up
  (usually within a few seconds).
- **Analyzing…** — the worker has claimed it and the five specialist
  reviewers (and then the Release Judge) are running against the real
  diff.
- **Complete** — every required reviewer and the judge finished. A real
  verdict (Approve / Approve with minor fixes / Do not approve) is shown,
  clamped to a deterministic floor computed from the findings — the judge
  alone can never make the result more lenient than the findings justify.
- **Failed** — a required reviewer or the judge didn't complete
  successfully (a crash, a timeout, a malformed AI response). This is
  deliberately **fail-closed**: a failed review is never treated as an
  approval, and the UI shows a generic failure message rather than raw
  provider error text (the real error is in the server logs, not the UI).

---

## Testing

```bash
npm test           # unit tests (vitest)
npm run test:rls    # RLS policy tests against a real disposable Postgres (needs Docker)
npm run typecheck   # tsc --noEmit
npm run lint         # eslint
npm run build        # production build
```

`test:rls` binds its disposable Postgres container to host port `55432`
(unrelated to `supabase start`'s own ports in `supabase/config.toml`, and
torn down automatically when the script exits). If that port is taken,
override it: `SHIPSAFE_RLS_TEST_PORT=55433 npm run test:rls`.

## Troubleshooting

#### Webhook tunnel expired
Quick tunnels (`cloudflared tunnel --url ...` with no named tunnel) get a
**new random URL every time you restart them**. If GitHub's Advanced →
Recent Deliveries tab shows failures with no response at all (see
below), your App's Webhook URL is almost certainly pointing at a tunnel
that's no longer running. Start a fresh tunnel and update the App's
**Webhook URL** setting to match the new one.

#### GitHub webhook 502/504
- **502 "failed to connect to host"** — the request never reached your
  app at all; this is the tunnel-expired case above, not a ShipSafe bug.
- **504 timed out** — the request reached your app but it took too long
  to respond. The webhook handler itself only validates and enqueues
  (well under a second) — it never waits on AI reviewers. A 504 here
  means something else is slow or stuck (e.g. `npm run dev` isn't
  actually running, or Supabase is unreachable) — check your dev server's
  terminal output for the actual error.

#### Pending migrations
Symptoms: errors like "received malformed review rows from supabase", or
a column that "doesn't exist" in server logs. Run:
```bash
supabase migration up
```
`supabase/migrations/` and the local database can drift apart any time
you pull new commits that add a migration — this is safe to run anytime
and a no-op if nothing's pending.

`npm run test:rls` can fail once with `the database system is shutting
down` the very first time you run it — that's the upstream Supabase
Postgres image restarting itself partway through its own startup, not a
migration problem. Just run it again.

#### Anthropic key/provider configuration
If reviews keep showing generic heuristic-style findings (e.g. summaries
like "No correctness issues detected in the changed lines.") when you
expected real Claude output, check:
- `AI_PROVIDER=anthropic` is actually set in `.env.local` (not just
  `ANTHROPIC_API_KEY` alone — the provider still defaults to `mock`
  without it).
- `ANTHROPIC_API_KEY` is non-empty.
- You restarted `npm run dev` after editing `.env.local` — env vars are
  read once at process start, not hot-reloaded.

#### Port already in use
If `3000` is taken, Next.js automatically tries the next free port
(`3001`, `3002`, ...) and prints which one it picked — check your
terminal output. If you need a specific port, set `PORT`:
```bash
PORT=3001 npm run dev
```
Supabase's own local ports are configured in `supabase/config.toml`
(non-default, to reduce collisions with another local Supabase project on
the same machine) — if `supabase start` itself fails to bind a port,
check what else is already using it.

#### Duplicate webhook delivery
This is handled automatically at two layers, so you shouldn't need to do
anything:
- GitHub retrying the **same** delivery (its own `X-GitHub-Delivery` id)
  before your app acked it fast enough is deduped and returns `200`
  without re-processing.
- Any delivery — retried or manually redelivered — for a commit that's
  **already been reviewed** (same PR, same head SHA) is a no-op; reviews
  are bound to an exact commit and are never re-run for it.

If you redeliver a webhook and don't see a new review appear, this is
almost always why — check the PR's current head SHA against what's
already been reviewed on the dashboard.
