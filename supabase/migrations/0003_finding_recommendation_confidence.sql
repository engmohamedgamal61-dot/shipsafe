-- ---------------------------------------------------------------------------
-- Phase 3: AI-backed reviewers add a `recommendation` and `confidence` to
-- every finding (see docs/MVP-PLAN.md Phase 3, src/domain/schemas.ts).
--
-- Both end up NOT NULL, but this instance may already have `findings` rows
-- from Phase 1/2 mock reviews that predate these columns. Adding a NOT NULL
-- column directly would fail on any such row, so this migration adds each
-- column nullable, backfills existing rows with a safe default, THEN
-- applies the NOT NULL constraint — all in one transaction, so there's no
-- window where the column exists but the constraint is unenforced for new
-- writes.
-- ---------------------------------------------------------------------------

alter table public.findings add column if not exists recommendation text;
alter table public.findings add column if not exists confidence real;

update public.findings
set recommendation = 'No specific recommendation was recorded — this finding predates the recommendation field.'
where recommendation is null;

update public.findings
set confidence = 1
where confidence is null;

alter table public.findings alter column recommendation set not null;
alter table public.findings alter column confidence set not null;

alter table public.findings
  add constraint findings_confidence_range check (confidence >= 0 and confidence <= 1);
