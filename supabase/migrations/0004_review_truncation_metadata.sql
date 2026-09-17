-- ---------------------------------------------------------------------------
-- Phase 3: record whether a review's diff/changed-file list was truncated
-- by the Phase 2 ingest limits (see src/server/github/pr-hardening.ts)
-- before it was reviewed, so the dashboard never presents a truncated
-- review as if it covered the whole PR.
--
-- A literal boolean DEFAULT backfills every existing row as part of the
-- same ALTER TABLE statement, so — unlike supabase/migrations/0003 —
-- these can go straight to NOT NULL without a separate UPDATE step.
-- ---------------------------------------------------------------------------

alter table public.reviews
  add column if not exists diff_truncated boolean not null default false,
  add column if not exists changed_files_truncated boolean not null default false;
