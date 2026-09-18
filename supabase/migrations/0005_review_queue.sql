-- ---------------------------------------------------------------------------
-- Durable review queue: the webhook Route Handler no longer runs the AI
-- review pipeline inline (it was blowing GitHub's ~10s webhook timeout).
-- It now only creates a `reviews` row with status='pending' — which,
-- being a normal committed Postgres row, already survives a server
-- restart by itself — and returns immediately. A background worker
-- (src/server/github/review-worker.ts, started from instrumentation.ts)
-- polls for status='pending' rows and processes them through the
-- existing ReviewOrchestrator.
--
-- No new "job" table: `reviews.status` already models exactly the
-- queued -> running -> complete/failed lifecycle this needs (see
-- src/domain/types.ts RunStatus). This migration only adds what that
-- lifecycle was missing:
--   - `queued_at`: FIFO ordering for claiming pending rows. `started_at`
--     can't be used for this — it's null until a worker actually claims
--     the row, so every still-pending row would tie.
--   - `github_webhook_deliveries`: idempotency guard on GitHub's own
--     `X-GitHub-Delivery` header, so a delivery GitHub retries before we
--     ack it doesn't re-run the (cheap but non-free) ingestion path twice.
--     Deliberately a separate table, not a reviews column — it applies to
--     every webhook event type (installation, installation_repositories,
--     pull_request), not just ones that produce a review.
-- ---------------------------------------------------------------------------

alter table public.reviews
  add column if not exists queued_at timestamptz not null default now();

create index if not exists reviews_pending_queue_idx
  on public.reviews (queued_at)
  where status in ('pending', 'running');

create table if not exists public.github_webhook_deliveries (
  delivery_id text primary key,
  event text not null,
  received_at timestamptz not null default now()
);

-- Trusted-backend-only table (the webhook Route Handler, via the service
-- role client) — same shape as every other ingestion table: RLS on, no
-- policies, so even a signed-in user's own session client is denied by
-- default. Nothing here is ever read back through the UI.
alter table public.github_webhook_deliveries enable row level security;
