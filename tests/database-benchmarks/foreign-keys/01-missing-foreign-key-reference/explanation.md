# foreign-keys-01-missing-foreign-key-reference

`webhook_deliveries.repository_id` is `uuid not null` with no
`references public.repositories (id)` clause. Every cross-table column
in this codebase's real migrations (`supabase/migrations/0001_init.sql`)
declares its foreign key explicitly, including an `on delete` behavior —
this column's own name makes its intent unambiguous, so the omission is
a real, concretely-visible schema defect: Postgres will happily accept a
`repository_id` that names a repository which never existed, and a
deleted repository leaves orphaned delivery rows behind indefinitely.

Deliberately a "pure schema" bug: no application code, no query pattern,
nothing outside the 11-line migration is needed to confirm it — exactly
the kind of concrete, database-layer defect a Database Reviewer (as
opposed to a Code or Security Reviewer) exists to catch.
