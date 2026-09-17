# ShipSafe — GitHub Integration

GitHub integration is optional and self-hosted: every ShipSafe deployment
registers its **own** GitHub App and configures its own credentials as
environment variables. There is no "ShipSafe's own" GitHub App that all
self-hosters share. See `src/server/github/` for the implementation and
`docs/ARCHITECTURE.md` § Ports & Adapters for how this fits the rest of
the app.

## 1. Register a GitHub App

Go to **github.com/settings/apps/new** (or your org's equivalent) and
create an app with:

- **Homepage URL**: your deployment's URL (anything reachable is fine for
  this field; it's not used by ShipSafe).
- **Setup URL**: `https://<your-deployment>/api/github/setup`, and check
  "Redirect on update" so re-installs / permission changes round-trip
  through the same callback.
- **Webhook URL**: `https://<your-deployment>/api/webhooks/github`.
- **Webhook secret**: generate a random value (e.g. `openssl rand -hex 32`)
  and keep it — it becomes `GITHUB_WEBHOOK_SECRET` below.
- **Repository permissions**:
  - Metadata — Read-only (mandatory)
  - Pull requests — Read-only (ShipSafe reads PR metadata, diffs, and
    changed files; it does not comment or push yet — see
    `docs/MVP-PLAN.md` Phase 2 for planned inline comments / status
    checks)
- **Subscribe to events**: `Installation`, `Installation repositories`,
  `Pull request`.
- **Where can this GitHub App be installed?**: either option works;
  "Only on this account" is simplest while testing.

After creating the app:

1. Note the **App ID** and the app's **slug** (the `apps/<slug>` segment
   of its settings URL).
2. Generate a **private key** (PEM) from the app's settings page and
   download it.

## 2. Configure environment variables

All four of these must be set together to activate the integration (see
`isGitHubConfigured` in `src/lib/env.ts`); GitHub integration also
requires Supabase to be configured (`NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) — there is
no workspace/database to attach an installation to in demo mode.

```
GITHUB_APP_ID=123456
GITHUB_APP_SLUG=your-app-slug
GITHUB_APP_PRIVATE_KEY=<PEM contents>
GITHUB_WEBHOOK_SECRET=<the webhook secret from step 1>
```

`GITHUB_APP_PRIVATE_KEY` accepts the PEM either as real newlines or with
literal `\n` escape sequences (`githubAppPrivateKey()` in `src/lib/env.ts`
un-escapes them) — most hosting providers' env var UIs don't let you paste
real newlines, so `\n`-escaping the key when you set the variable is the
usual path:

```
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\n-----END RSA PRIVATE KEY-----\n"
```

Also set `APP_SECRET` to a real random value in any shared/production
deployment (it signs both the demo-session cookie and the GitHub install
"state" token — see `src/server/github/install-state.ts`); the default in
`.env.example` is dev-only.

## 3. Local development

You don't need a public URL to run ShipSafe itself — only to *receive*
GitHub's webhook deliveries and the Setup URL redirect. Use a tunnel
(e.g. `ngrok http 3000` or `cloudflared tunnel --url http://localhost:3000`)
and point the App's Webhook URL and Setup URL at the tunnel's HTTPS
origin instead of `localhost`. GitHub also lets you redeliver any past
webhook from the app's "Advanced" tab, which is the fastest way to
re-test the `pull_request` handler without opening a new PR each time.

## 4. How the flow works

1. **Install** — a user clicks "Connect GitHub" (`src/app/actions/github.ts`),
   which signs a short-lived `state` token binding their workspace + user
   id (`src/server/github/install-state.ts`) and redirects them to
   GitHub's own installation UI.
2. **Setup callback** — once they finish picking an account/repositories,
   GitHub redirects back to the Setup URL
   (`src/app/api/github/setup/route.ts`) with `installation_id` and the
   echoed `state`. ShipSafe verifies the state, links the installation to
   the workspace, and does an immediate full repository sync
   (`src/server/github/connect.ts`) so the user sees their repos right
   away instead of waiting on a webhook.
3. **Webhooks** — `src/app/api/webhooks/github/route.ts` verifies each
   delivery's `X-Hub-Signature-256` header and dispatches to
   `src/server/github/ingest.ts`:
   - `installation` — install/uninstall/suspend/unsuspend.
   - `installation_repositories` — repos added/removed from an existing
     installation.
   - `pull_request` (`opened`/`reopened`/`synchronize`) — fetches the PR's
     diff and changed files via the GitHub API, creates an immutable
     review row bound to the exact head SHA (a redelivered webhook for a
     commit already reviewed is a no-op — see `docs/ARCHITECTURE.md` §
     Commit Binding), and runs the review engine against the real diff.

All database writes for the integration go through
`src/server/github/writes.ts`, using the service-role Supabase client —
see `docs/ARCHITECTURE.md` § Server-Authoritative Writes & RLS for why
that's the only place allowed to write these tables.

Webhook handler failures return HTTP 500 so GitHub retries delivery;
every write in the ingestion path is upsert/idempotent by natural key
(`provider,external_repository_id` for repos, `repository_id,number` for
PRs, `pull_request_id,reviewed_head_sha` for reviews), so a retried
delivery is safe.

## 5. Troubleshooting

- **"Connect GitHub" is disabled** — one or more of the four GitHub env
  vars (or Supabase) isn't set; check `isGitHubConfigured` in
  `src/lib/env.ts`.
- **Redirected back with `?github_error=...`** — see the message shown on
  `/repositories`; the underlying cause (e.g. `install_failed`) is logged
  server-side via `logger.error`.
- **Webhook returns 401** — the payload's signature didn't match
  `GITHUB_WEBHOOK_SECRET`; double check the secret configured on the
  GitHub App matches the deployment's env var exactly.
- **A PR never gets reviewed** — confirm the `pull_request` event is
  subscribed to on the App, and check the webhook's recent deliveries tab
  on GitHub for the response ShipSafe returned.
