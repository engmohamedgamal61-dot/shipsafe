-- Adds saved dashboard filter presets per workspace.

create table if not exists public.saved_filters (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_by uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  filter_json jsonb not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, name)
);

create index if not exists saved_filters_workspace_id_idx on public.saved_filters (workspace_id);
