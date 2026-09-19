-- Adds per-workspace billing invoices.

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  amount_cents integer not null,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create index if not exists invoices_workspace_id_idx on public.invoices (workspace_id);

-- NOTE: no `alter table public.invoices enable row level security;` and
-- no policies follow. The anon/authenticated Postgres roles this table
-- is reachable through therefore have whatever grants Postgres/Supabase
-- assigns by default, with no per-row restriction at all.
