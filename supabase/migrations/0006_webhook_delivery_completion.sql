-- ---------------------------------------------------------------------------
-- Fix for v1 audit HIGH-1: the webhook idempotency guard
-- (`github_webhook_deliveries`, added in 0005) recorded a delivery id as
-- "seen" the moment it was FIRST ATTEMPTED, not once it actually finished
-- successfully. If processing then failed (a transient GitHub API 5xx, a
-- DB blip), GitHub's redelivery of that exact same delivery id was
-- treated as a duplicate and silently dropped — permanently, since
-- nothing ever cleared the row.
--
-- `completed_at` (null until a delivery finishes successfully) lets
-- `claimWebhookDelivery`/`markWebhookDeliveryCompleted`
-- (src/server/github/writes.ts) distinguish three states for a delivery
-- id that already has a row: genuinely completed (skip forever), still
-- within a plausible in-flight window (skip — avoids two identical
-- deliveries processing concurrently), or stale/abandoned past that
-- window (safe to reclaim and retry).
-- ---------------------------------------------------------------------------

alter table public.github_webhook_deliveries
  add column if not exists completed_at timestamptz;
