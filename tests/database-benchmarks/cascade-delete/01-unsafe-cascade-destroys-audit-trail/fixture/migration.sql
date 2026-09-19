-- Adds an audit log of workspace-owner actions for compliance review.

create table if not exists public.workspace_audit_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  actor_id uuid not null references public.profiles (id) on delete cascade,
  action text not null,
  created_at timestamptz not null default now()
);

create index if not exists workspace_audit_log_workspace_id_idx on public.workspace_audit_log (workspace_id);
