-- Adds workspace-scoped API keys for programmatic access.

create table if not exists public.workspace_api_keys (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  key_hash text not null,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (workspace_id, name)
);

create index if not exists workspace_api_keys_workspace_id_idx on public.workspace_api_keys (workspace_id);
create unique index if not exists workspace_api_keys_key_hash_idx on public.workspace_api_keys (key_hash);
