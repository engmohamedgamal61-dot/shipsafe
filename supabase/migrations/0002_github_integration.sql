-- ShipSafe Phase 2: GitHub App integration.
--
-- Adds `github_installations` (which GitHub account/org has installed
-- the self-hoster's own GitHub App, and which workspace that's linked
-- to) and links `repositories` to the installation that owns them.
--
-- Nothing here references any specific GitHub account, org, repo, or
-- installation — those are all runtime data written by the webhook/setup
-- handlers in src/server/github/, driven entirely by whichever GitHub
-- App each self-hoster registers for themselves.

create table if not exists public.github_installations (
  id uuid primary key default gen_random_uuid(),
  -- GitHub's installation id. Stored as text: it's an opaque external
  -- identifier we only ever compare for equality, never do arithmetic
  -- on, and text sidesteps any bigint/number precision questions.
  installation_id text not null unique,
  account_login text not null,
  account_type text not null check (account_type in ('User', 'Organization')),
  -- Null until the setup-URL callback (or a race-winning webhook) links
  -- it to a workspace — see src/server/github/ingest.ts. A workspace can
  -- have multiple installations (e.g. a personal account + an org).
  workspace_id uuid references public.workspaces (id) on delete set null,
  suspended boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists github_installations_workspace_id_idx on public.github_installations (workspace_id);

alter table public.repositories
  add column if not exists github_installation_id uuid references public.github_installations (id) on delete set null;

create index if not exists repositories_github_installation_id_idx on public.repositories (github_installation_id);

-- RLS: same shape as the other authoritative tables (pull_requests,
-- reviews, ...) — installations are ingested/managed by the trusted
-- backend (setup-URL callback + webhooks, both using the service role),
-- never written directly by a client. Workspace members get read access
-- so the UI can show "Connected as @org-name".

alter table public.github_installations enable row level security;

create policy "github_installations: members read" on public.github_installations
  for select using (
    workspace_id is not null and public.is_workspace_member(workspace_id, auth.uid())
  );

-- ---------------------------------------------------------------------------
-- Auto-create a personal workspace at sign-up.
--
-- Connecting a GitHub repository requires a workspace to attach it to.
-- Demo mode already has one seeded (DEMO_WORKSPACE_ID in
-- src/server/auth/demo-adapter.ts); real (configured-mode) sign-ups had
-- no equivalent until now — `handle_new_user` (0001_init.sql) only
-- created a `profiles` row. Extending it here (rather than requiring a
-- separate "create your workspace" step) means a freshly signed-up user
-- can connect a repository immediately. The existing
-- `on_workspace_created` trigger (0001_init.sql) still fires and makes
-- them its owner — this function doesn't duplicate that.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  workspace_name text;
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);

  workspace_name := coalesce(nullif(split_part(new.email, '@', 1), ''), 'My') || ' Workspace';

  insert into public.workspaces (id, name, slug, created_by)
  values (
    gen_random_uuid(),
    workspace_name,
    'ws-' || replace(new.id::text, '-', ''),
    new.id
  );

  return new;
end;
$$;
