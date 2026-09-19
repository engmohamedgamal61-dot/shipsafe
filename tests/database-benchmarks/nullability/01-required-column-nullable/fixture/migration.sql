-- Adds workspace billing invoices.

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  amount_cents integer,
  status text not null default 'pending' check (status in ('pending', 'paid', 'void')),
  created_at timestamptz not null default now()
);

create index if not exists invoices_workspace_id_idx on public.invoices (workspace_id);
