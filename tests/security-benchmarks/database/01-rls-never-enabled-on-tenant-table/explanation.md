# database-01-rls-never-enabled-on-tenant-table

**What this tests:** the clearest possible RLS/cross-tenant gap — a
migration file, no RLS statement anywhere, a table that's obviously
tenant-scoped by its own foreign key. No inference required.

**Why it's shaped this way:** SQL-only (no application code) so this
fixture also exercises the loader/benchmark infra against a non-`.ts`
file type, and so nothing about the finding can be confused with an
application-layer access-control bug (fixture 01) — this is specifically
about the database layer never having a tenant boundary defined at all.

**What would make this fixture wrong:** if an `alter table ... enable
row level security` statement (with or without policies) appeared
anywhere in this file, or if `invoices` were shown to be a
service-role-only table by design (it isn't here — nothing suggests
that).
