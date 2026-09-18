# Fresh Install Checklist

A concise, checkbox pass for validating ShipSafe boots correctly on a
machine that's never seen this repo before — no assumptions about
anything already configured on the machine you developed on. Full
explanations for every step are in [`README.md`](../README.md).

Do this in order; each section assumes the previous one passed.

## 1. Clone

- [ ] `git clone <repo-url>` succeeds on a clean checkout (no cached
      `node_modules`, no pre-existing `.env.local`)
- [ ] `cd shipsafe`

## 2. Install

- [ ] `node -v` reports **20.9 or newer**
- [ ] `npm install` completes with no errors

## 3. Demo mode sanity check (before touching any config)

- [ ] `npm run dev` starts without needing `.env.local` to exist at all
- [ ] `http://localhost:3000` loads and shows a "Demo Mode" badge
- [ ] The seeded demo review renders findings and a verdict (proves the
      review engine itself works, independent of Supabase/GitHub)
- [ ] Stop the dev server (`Ctrl+C`) before continuing

## 4. Environment file

- [ ] `cp .env.example .env.local`
- [ ] Confirm `.env.local` is **not** tracked by git (`git status` shows
      nothing for it — it's covered by `.gitignore`)

## 5. Local Supabase

- [ ] Docker is running
- [ ] `supabase --version` resolves (CLI installed)
- [ ] `supabase start` succeeds and prints an API URL + anon key +
      service role key
- [ ] Those three values are copied into `.env.local`
      (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
      `SUPABASE_SERVICE_ROLE_KEY`)

## 6. Migrations

- [ ] `supabase migration up` reports every migration in
      `supabase/migrations/` as applied
- [ ] `npm run test:rls` passes against a real (disposable) Postgres —
      confirms RLS policies match the schema, not just that migrations
      ran without a SQL error

## 7. App boot against real Supabase

- [ ] `npm run dev` starts clean (no "Invalid environment configuration"
      error — confirms `.env.local` parses)
- [ ] `http://localhost:3000` no longer shows the "Demo Mode" badge
- [ ] No errors in the terminal or browser console on first load

## 8. Auth

- [ ] `/sign-up` creates an account with no email-confirmation step
      required (local Supabase has confirmations disabled by default)
- [ ] After signup, you land on a workspace that's yours, not shared
      demo data
- [ ] Signing out and back in via `/sign-in` works

## 9. GitHub App setup

- [ ] A tunnel (`cloudflared`, `ngrok`, or equivalent) is running and its
      HTTPS URL is reachable from a browser
- [ ] A GitHub App is registered with:
  - [ ] Setup URL → `<tunnel-url>/api/github/setup`
  - [ ] Webhook URL → `<tunnel-url>/api/webhooks/github`
  - [ ] Metadata / Pull requests / Contents permissions, all read-only
  - [ ] Subscribed to `Installation`, `Installation repositories`,
        `Pull request`
- [ ] `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY`,
      `GITHUB_WEBHOOK_SECRET` are all set in `.env.local`
- [ ] Dev server restarted after adding them
- [ ] **Connect GitHub** on `/repositories` completes the GitHub install
      flow and the repository appears immediately (before any webhook)

## 10. First real review

- [ ] Opening (or redelivering) a `pull_request` webhook returns `200`/`202`
      on GitHub's Recent Deliveries tab, in well under a second
- [ ] The review appears on the dashboard as **Queued**, then
      **Analyzing…**, then a terminal **Complete**/**Failed** state —
      without a manual page refresh
- [ ] (If `AI_PROVIDER=anthropic` is set) the completed review's reviewer
      cards show `anthropic` / a real model name, not `mock`

## 11. Full verification suite

- [ ] `npm test`
- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm run build`

If every box above is checked, the environment is a verified match for
what ShipSafe expects — anything that fails after this point is a real
bug, not an environment gap.
