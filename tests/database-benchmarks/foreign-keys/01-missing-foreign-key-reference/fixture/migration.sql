-- Adds per-repository webhook delivery logs for audit/debugging.

create table if not exists public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  repository_id uuid not null,
  event_type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now()
);

create index if not exists webhook_deliveries_repository_id_idx on public.webhook_deliveries (repository_id);
