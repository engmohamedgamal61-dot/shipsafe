-- RLS integration tests for ShipSafe.
--
-- Run against a real Postgres instance provisioned from Supabase's own
-- `postgres` image (which ships the real `auth` schema, roles, and
-- `auth.uid()`), NOT a mock. See scripts/test-rls.sh for how to run this
-- locally/in CI — it needs Docker, so it is not part of `npm test`.
--
-- The whole file runs as ONE transaction that is always ROLLED BACK at
-- the end (never committed), so it leaves no residue and can be re-run
-- against the same database as many times as needed. Role/claim switches
-- happen via `SET LOCAL` — the same mechanism PostgREST (and therefore
-- every Supabase client library) uses to authenticate a request — and
-- apply to the rest of the transaction until changed again.
--
-- Convention: every check is a DO block that RAISEs an exception (which
-- aborts the whole script with a non-zero exit, since we run psql with
-- -v ON_ERROR_STOP=1) if the assertion fails, and a NOTICE on success.
-- For UPDATE/DELETE, Postgres RLS silently filters to 0 affected rows
-- when no policy grants the operation — no exception is thrown, so those
-- checks assert on row counts. For INSERT, a missing policy raises a hard
-- `insufficient_privilege` (42501) error instead, so those checks also
-- carry an exception handler.

\set ON_ERROR_STOP on

begin;

-- ===========================================================================
-- Fixtures — inserted as service_role (the trusted-backend path), which
-- has BYPASSRLS. This is also, implicitly, test coverage for "trusted
-- backend path can write results": if service_role could not write these
-- rows, the whole script would fail right here.
-- ===========================================================================

-- auth.users is owned by supabase_auth_admin in a real Supabase project
-- (GoTrue writes it, not application code) — service_role isn't granted
-- INSERT on it, matching production. We create these fixture users as the
-- session's superuser instead; everything from here on on public.*
-- tables goes through service_role, which is the actual trusted-backend
-- write path this test is verifying.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'eve@example.com');

set local role service_role;

-- Alice creates a workspace; the on_workspace_created trigger makes her
-- its owner atomically.
insert into public.workspaces (id, name, slug, created_by) values
  ('a1000000-0000-0000-0000-000000000001', 'Alice Co', 'alice-co', '11111111-1111-1111-1111-111111111111');

-- Bob joins as a plain member (inserted directly here as the trusted
-- backend would when accepting an invite — Phase 1 has no invite flow yet).
insert into public.workspace_memberships (workspace_id, user_id, role) values
  ('a1000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'member');

-- Eve is a member of nothing — used for the cross-tenant isolation checks.

insert into public.repositories (id, workspace_id, provider, external_repository_id, name, full_name, default_branch) values
  ('a2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'demo', null, 'payments-service', 'acme/payments-service', 'main');

insert into public.pull_requests (id, repository_id, number, title, source_branch, target_branch, author_login, head_sha, base_sha) values
  ('a3000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 1, 'Add usage billing', 'feat/billing', 'main', 'alice', 'headsha1', 'basesha1');

insert into public.reviews (id, pull_request_id, status, verdict, summary, reviewed_head_sha, started_at, completed_at) values
  ('a4000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000001', 'complete', 'APPROVE_WITH_MINOR_FIXES', 'looks mostly fine', 'headsha1', now(), now());

insert into public.reviewer_runs (id, review_id, reviewer, status, summary, completed_at) values
  ('a5000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000001', 'security', 'complete', 'found a hardcoded secret', now());

insert into public.findings (id, reviewer_run_id, severity, title, description, category) values
  ('a6000000-0000-0000-0000-000000000001', 'a5000000-0000-0000-0000-000000000001', 'P0', 'Hardcoded secret', 'a secret is hardcoded', 'hardcoded-secret'),
  ('a6000000-0000-0000-0000-000000000002', 'a5000000-0000-0000-0000-000000000001', 'P1', 'Missing test', 'no test for this change', 'missing-test');

do $$ begin raise notice 'PASS: fixtures created via service_role (trusted backend can write results)'; end $$;

-- ===========================================================================
-- Owner (Alice) can read her own reviews / reviewer_runs / findings.
-- ===========================================================================

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

do $$
begin
  if (select count(*) from public.reviews where id = 'a4000000-0000-0000-0000-000000000001') <> 1 then
    raise exception 'FAIL: owner could not read own review';
  end if;
  if (select count(*) from public.reviewer_runs where review_id = 'a4000000-0000-0000-0000-000000000001') <> 1 then
    raise exception 'FAIL: owner could not read own reviewer_runs';
  end if;
  if (select count(*) from public.findings where reviewer_run_id = 'a5000000-0000-0000-0000-000000000001') <> 2 then
    raise exception 'FAIL: owner could not read own findings';
  end if;
  raise notice 'PASS: owner reads own reviews/reviewer_runs/findings';
end $$;

-- ===========================================================================
-- Owner cannot modify the verdict directly.
-- ===========================================================================

do $$
declare
  affected int;
begin
  update public.reviews set verdict = 'APPROVE' where id = 'a4000000-0000-0000-0000-000000000001';
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'FAIL: owner was able to modify the verdict (% row(s) affected)', affected;
  end if;
  raise notice 'PASS: owner cannot modify the verdict';
end $$;

-- Verify (as service_role, bypassing RLS) that the verdict is unchanged.
set local role service_role;
do $$
begin
  if (select verdict from public.reviews where id = 'a4000000-0000-0000-0000-000000000001') <> 'APPROVE_WITH_MINOR_FIXES' then
    raise exception 'FAIL: verdict was mutated despite RLS';
  end if;
  raise notice 'PASS: verdict remained APPROVE_WITH_MINOR_FIXES after the denied update attempt';
end $$;

-- ===========================================================================
-- Owner cannot delete a P0 (or P1) finding.
-- ===========================================================================

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

do $$
declare
  affected int;
begin
  delete from public.findings where id = 'a6000000-0000-0000-0000-000000000001'; -- P0
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'FAIL: owner deleted a P0 finding (% row(s) affected)', affected;
  end if;

  delete from public.findings where id = 'a6000000-0000-0000-0000-000000000002'; -- P1
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'FAIL: owner deleted a P1 finding (% row(s) affected)', affected;
  end if;

  raise notice 'PASS: owner cannot delete P0/P1 findings';
end $$;

-- ===========================================================================
-- Owner cannot fabricate reviewer success (insert a fake reviewer_run).
-- INSERT under RLS with no matching policy raises 42501
-- (insufficient_privilege) rather than silently affecting 0 rows.
-- ===========================================================================

do $$
begin
  insert into public.reviewer_runs (id, review_id, reviewer, status, summary, completed_at)
  values ('a5000000-0000-0000-0000-0000000000fa', 'a4000000-0000-0000-0000-000000000001', 'test', 'complete', 'fabricated by client', now());
  raise exception 'FAIL: owner fabricated a fake reviewer_run — insert should have been rejected';
exception
  when insufficient_privilege then
    raise notice 'PASS: owner cannot fabricate a reviewer_run (insufficient_privilege)';
end $$;

-- ===========================================================================
-- Cross-user isolation: Eve (not a member of Alice's workspace) sees nothing.
-- ===========================================================================

set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';

do $$
begin
  if (select count(*) from public.workspaces where id = 'a1000000-0000-0000-0000-000000000001') <> 0 then
    raise exception 'FAIL: non-member could see the workspace';
  end if;
  if (select count(*) from public.repositories where id = 'a2000000-0000-0000-0000-000000000001') <> 0 then
    raise exception 'FAIL: non-member could see the repository';
  end if;
  if (select count(*) from public.reviews where id = 'a4000000-0000-0000-0000-000000000001') <> 0 then
    raise exception 'FAIL: non-member could see the review';
  end if;
  if (select count(*) from public.findings where reviewer_run_id = 'a5000000-0000-0000-0000-000000000001') <> 0 then
    raise exception 'FAIL: non-member could see findings';
  end if;
  raise notice 'PASS: cross-user access is denied for a user outside the workspace';
end $$;

-- ===========================================================================
-- Membership role differentiation: Bob (member, not owner) can read but
-- cannot manage the repository or workspace membership.
-- ===========================================================================

set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

do $$
declare
  affected int;
begin
  if (select count(*) from public.reviews where id = 'a4000000-0000-0000-0000-000000000001') <> 1 then
    raise exception 'FAIL: workspace member could not read the review';
  end if;

  update public.repositories set default_branch = 'develop' where id = 'a2000000-0000-0000-0000-000000000001';
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'FAIL: non-owner member modified repository metadata (% row(s) affected)', affected;
  end if;

  raise notice 'PASS: member reads workspace data but cannot manage repositories';
end $$;

do $$
begin
  insert into public.workspace_memberships (workspace_id, user_id, role)
  values ('a1000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'member');
  raise exception 'FAIL: non-owner member added a new member — insert should have been rejected';
exception
  when insufficient_privilege then
    raise notice 'PASS: non-owner member cannot add a new member (insufficient_privilege)';
end $$;

-- ===========================================================================
-- Sanity check: the workspace owner CAN manage repository metadata — we
-- didn't accidentally lock down user-managed metadata along with the
-- authoritative tables.
-- ===========================================================================

set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

do $$
declare
  affected int;
begin
  update public.repositories set default_branch = 'develop' where id = 'a2000000-0000-0000-0000-000000000001';
  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception 'FAIL: owner could not update their own repository metadata (% row(s) affected)', affected;
  end if;
  raise notice 'PASS: workspace owner can manage repository metadata';
end $$;

\echo 'ALL RLS TESTS PASSED'

rollback;
