-- ShipSafe schema.
--
-- Tenancy: profiles -> workspace_memberships -> workspaces -> repositories
--          -> pull_requests -> reviews -> reviewer_runs -> findings
--
-- Authority model (see docs/ARCHITECTURE.md § Server-Authoritative Writes):
--   - profiles, workspaces, workspace_memberships, repositories: normal
--     user-managed metadata. Workspace owners can read/write via RLS.
--   - pull_requests, reviews, reviewer_runs, findings: authoritative,
--     computed data. Authenticated users get READ-ONLY access via RLS.
--     All writes to these four tables happen through the service role
--     (see src/lib/supabase/service.ts) from trusted backend code — never
--     from a client-held session, and never through a client-facing
--     policy. There is deliberately no INSERT/UPDATE/DELETE policy for
--     the `authenticated` role on any of the four.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- profiles — one row per authenticated user, mirrors auth.users.
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------------------------
-- workspaces / workspace_memberships — minimal tenancy. Every repository
-- belongs to a workspace, never directly to a user. Kept intentionally
-- small for Phase 1: owner/member only, no billing or invitations.
-- ---------------------------------------------------------------------------

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_memberships (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index if not exists workspace_memberships_user_id_idx on public.workspace_memberships (user_id);

-- Creating a workspace atomically makes the creator its owner — done as a
-- SECURITY DEFINER trigger so there's no window where a workspace exists
-- with no owner member, and no client-writable membership-insert path is
-- needed just to seed the first row.
create or replace function public.handle_new_workspace()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.workspace_memberships (workspace_id, user_id, role)
  values (new.id, new.created_by, 'owner');
  return new;
end;
$$;

drop trigger if exists on_workspace_created on public.workspaces;
create trigger on_workspace_created
  after insert on public.workspaces
  for each row execute procedure public.handle_new_workspace();

-- Membership-check helpers used by RLS policies below. These MUST be
-- SECURITY DEFINER: a policy on workspace_memberships that queries
-- workspace_memberships directly (even via a JOIN from another table's
-- policy in a longer chain) causes Postgres to report "infinite
-- recursion detected in policy" because evaluating the policy re-triggers
-- RLS on the same table. Wrapping the check in a SECURITY DEFINER
-- function evaluates it with the function owner's privileges, which does
-- not re-enter RLS.
create or replace function public.is_workspace_member(p_workspace_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.workspace_memberships
    where workspace_id = p_workspace_id and user_id = p_user_id
  );
$$;

create or replace function public.is_workspace_owner(p_workspace_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.workspace_memberships
    where workspace_id = p_workspace_id and user_id = p_user_id and role = 'owner'
  );
$$;

-- ---------------------------------------------------------------------------
-- repositories — user-managed connection metadata (which repos a
-- workspace has connected). Stable external identity so repeated webhook
-- deliveries can never create duplicate rows.
-- ---------------------------------------------------------------------------

create table if not exists public.repositories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  provider text not null check (provider in ('github', 'demo')),
  external_repository_id text,
  name text not null,
  full_name text not null,
  default_branch text not null default 'main',
  connected_at timestamptz not null default now(),
  -- NULLS are distinct in a unique index, so multiple demo repos (no
  -- external id) are still allowed; a real (provider, external id) pair
  -- can only be connected once, anywhere.
  unique (provider, external_repository_id)
);

create index if not exists repositories_workspace_id_idx on public.repositories (workspace_id);

-- ---------------------------------------------------------------------------
-- pull_requests — authoritative, ingested data. Tracks the PR's current
-- known head/base SHAs; individual reviews pin their own exact commit
-- (see `reviews.reviewed_head_sha`) so a review is never silently reused
-- across commits even as this row's head_sha moves forward.
-- ---------------------------------------------------------------------------

create table if not exists public.pull_requests (
  id uuid primary key default gen_random_uuid(),
  repository_id uuid not null references public.repositories (id) on delete cascade,
  external_pull_request_id text,
  number integer not null,
  title text not null,
  source_branch text not null,
  target_branch text not null,
  author_login text not null,
  changed_files jsonb not null default '[]'::jsonb,
  diff_text text not null default '',
  head_sha text not null,
  base_sha text not null,
  opened_at timestamptz not null default now(),
  unique (repository_id, number)
);

create index if not exists pull_requests_repository_id_idx on public.pull_requests (repository_id);

-- ---------------------------------------------------------------------------
-- reviews — one immutable review of one exact commit. `reviewed_head_sha`
-- is never updated after insert; a new commit always gets a new row.
-- ---------------------------------------------------------------------------

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  pull_request_id uuid not null references public.pull_requests (id) on delete cascade,
  status text not null check (status in ('pending', 'running', 'complete', 'failed')) default 'pending',
  verdict text check (verdict in ('APPROVE', 'APPROVE_WITH_MINOR_FIXES', 'DO_NOT_APPROVE')),
  summary text,
  failure_reason text,
  reviewed_head_sha text not null,
  reviewed_base_sha text,
  rule_version text not null default 'v1',
  prompt_version text,
  started_at timestamptz,
  completed_at timestamptz,

  -- A given commit is reviewed at most once per PR row. A deliberate
  -- re-run of the same commit replaces this row rather than accumulating
  -- duplicates from repeated webhook delivery.
  unique (pull_request_id, reviewed_head_sha),

  -- Review state integrity: a completion state always carries the
  -- completion metadata that goes with it, and an incomplete state never
  -- fakes having it.
  constraint reviews_complete_has_verdict_and_timestamp check (
    status <> 'complete' or (verdict is not null and completed_at is not null)
  ),
  constraint reviews_failed_has_reason_and_timestamp check (
    status <> 'failed' or (failure_reason is not null and completed_at is not null)
  ),
  constraint reviews_pending_has_no_completion_metadata check (
    status not in ('pending', 'running')
    or (verdict is null and completed_at is null and failure_reason is null)
  )
);

create index if not exists reviews_pull_request_id_idx on public.reviews (pull_request_id);

-- ---------------------------------------------------------------------------
-- reviewer_runs — one specialist agent's execution within a review, plus
-- the execution metadata needed for future retries/billing.
-- ---------------------------------------------------------------------------

create table if not exists public.reviewer_runs (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews (id) on delete cascade,
  reviewer text not null check (
    reviewer in ('code', 'security', 'architecture', 'database', 'test', 'judge')
  ),
  status text not null check (status in ('pending', 'running', 'complete', 'failed')) default 'pending',
  summary text,
  error_message text,
  provider text,
  model text,
  request_id text,
  input_tokens integer,
  output_tokens integer,
  latency_ms integer,
  attempt integer not null default 1 check (attempt >= 1),
  started_at timestamptz,
  completed_at timestamptz,
  unique (review_id, reviewer),
  constraint reviewer_runs_complete_has_timestamp check (
    status <> 'complete' or completed_at is not null
  ),
  constraint reviewer_runs_failed_has_reason check (
    status <> 'failed' or error_message is not null
  )
);

create index if not exists reviewer_runs_review_id_idx on public.reviewer_runs (review_id);

-- ---------------------------------------------------------------------------
-- findings — individual findings, owned by a reviewer run.
-- ---------------------------------------------------------------------------

create table if not exists public.findings (
  id uuid primary key default gen_random_uuid(),
  reviewer_run_id uuid not null references public.reviewer_runs (id) on delete cascade,
  severity text not null check (severity in ('P0', 'P1', 'P2', 'NIT')),
  title text not null,
  description text not null,
  file_path text,
  line_start integer check (line_start is null or line_start >= 1),
  line_end integer check (line_end is null or line_start is null or line_end >= line_start),
  category text not null
);

create index if not exists findings_reviewer_run_id_idx on public.findings (reviewer_run_id);
create index if not exists findings_severity_idx on public.findings (severity);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_memberships enable row level security;
alter table public.repositories enable row level security;
alter table public.pull_requests enable row level security;
alter table public.reviews enable row level security;
alter table public.reviewer_runs enable row level security;
alter table public.findings enable row level security;

create policy "profiles: read own" on public.profiles
  for select using (auth.uid() = id);

-- workspaces: members can read; only an owner can update/delete. Insert is
-- open to any authenticated user (creating a new workspace) — the
-- SECURITY DEFINER trigger above is what makes the creator its owner, so
-- there's no separate "insert your own membership" policy needed or
-- allowed.
create policy "workspaces: members read" on public.workspaces
  for select using (public.is_workspace_member(id, auth.uid()));

create policy "workspaces: authenticated users create" on public.workspaces
  for insert with check (created_by = auth.uid());

create policy "workspaces: owner update" on public.workspaces
  for update using (public.is_workspace_owner(id, auth.uid()));

create policy "workspaces: owner delete" on public.workspaces
  for delete using (public.is_workspace_owner(id, auth.uid()));

-- workspace_memberships: any member can see who else is in the workspace;
-- only an owner can add/remove/change members via the client. (The
-- owner's own initial membership row is inserted by the trigger above,
-- which runs as SECURITY DEFINER and therefore bypasses this policy.)
-- Both checks MUST go through the SECURITY DEFINER helpers above, not an
-- inline EXISTS against this same table — see the comment on those
-- functions for why (infinite recursion).
create policy "workspace_memberships: members read" on public.workspace_memberships
  for select using (public.is_workspace_member(workspace_id, auth.uid()));

create policy "workspace_memberships: owner manages" on public.workspace_memberships
  for all
  using (public.is_workspace_owner(workspace_id, auth.uid()))
  with check (public.is_workspace_owner(workspace_id, auth.uid()));

-- repositories: normal user-managed metadata — members read, owners manage.
create policy "repositories: members read" on public.repositories
  for select using (public.is_workspace_member(workspace_id, auth.uid()));

create policy "repositories: owner manages" on public.repositories
  for all
  using (public.is_workspace_owner(workspace_id, auth.uid()))
  with check (public.is_workspace_owner(workspace_id, auth.uid()));

-- pull_requests / reviews / reviewer_runs / findings: authoritative,
-- ingested/computed data. Members get READ ONLY access. There is
-- deliberately no insert/update/delete policy for `authenticated` — all
-- writes come from trusted backend code using the service role, which
-- bypasses RLS entirely and is therefore unaffected by (and doesn't need)
-- any policy here.

create policy "pull_requests: members read" on public.pull_requests
  for select using (
    exists (
      select 1 from public.repositories r
      where r.id = pull_requests.repository_id
        and public.is_workspace_member(r.workspace_id, auth.uid())
    )
  );

create policy "reviews: members read" on public.reviews
  for select using (
    exists (
      select 1 from public.pull_requests pr
      join public.repositories r on r.id = pr.repository_id
      where pr.id = reviews.pull_request_id
        and public.is_workspace_member(r.workspace_id, auth.uid())
    )
  );

create policy "reviewer_runs: members read" on public.reviewer_runs
  for select using (
    exists (
      select 1 from public.reviews rv
      join public.pull_requests pr on pr.id = rv.pull_request_id
      join public.repositories r on r.id = pr.repository_id
      where rv.id = reviewer_runs.review_id
        and public.is_workspace_member(r.workspace_id, auth.uid())
    )
  );

create policy "findings: members read" on public.findings
  for select using (
    exists (
      select 1 from public.reviewer_runs rr
      join public.reviews rv on rv.id = rr.review_id
      join public.pull_requests pr on pr.id = rv.pull_request_id
      join public.repositories r on r.id = pr.repository_id
      where rr.id = findings.reviewer_run_id
        and public.is_workspace_member(r.workspace_id, auth.uid())
    )
  );
