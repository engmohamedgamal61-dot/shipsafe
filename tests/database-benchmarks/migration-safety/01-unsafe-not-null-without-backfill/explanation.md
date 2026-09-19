# migration-safety-01-unsafe-not-null-without-backfill

`alter table public.repositories add column active_rule_version text not
null` supplies no `default`. `public.repositories` is an existing,
already-populated table (it's created in the very first migration of
this codebase, `0001_init.sql`, and repositories are connected from day
one) — Postgres cannot satisfy `not null` for rows that already exist
with no value to put there, so this migration fails to apply at all, not
merely "unsafely."

Deliberately the clearest, least ambiguous migration-safety case in this
benchmark (P0/P1, high confidence both ways) — a contrasting AMBIGUOUS
migration-safety case (where the answer genuinely depends on unseen
table size/traffic) lives in `ambiguous/01-index-build-lock-risk-unknown-table-size`.
