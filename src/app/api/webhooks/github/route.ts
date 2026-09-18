import { NextResponse } from "next/server";
import type { z } from "zod";
import { env, isGitHubConfigured } from "@/lib/env";
import { logger } from "@/lib/logger";
import { verifyGithubSignature } from "@/server/github/webhook-signature";
import {
  handleInstallationEvent,
  handleInstallationRepositoriesEvent,
  handlePullRequestEvent,
} from "@/server/github/ingest";
import { recordWebhookDelivery } from "@/server/github/writes";
import {
  githubInstallationRepositoriesWebhookBodySchema,
  githubInstallationWebhookBodySchema,
  githubPullRequestWebhookBodySchema,
} from "@/server/github/types";

/**
 * GitHub App webhook endpoint. Configure this exact path as the
 * self-hoster's GitHub App "Webhook URL" —
 * `https://<your-deployment>/api/webhooks/github` — see
 * docs/GITHUB_INTEGRATION.md for local development (no public URL
 * required to run ShipSafe itself; you only need one to receive
 * webhooks, via a tunnel).
 */
export async function POST(request: Request) {
  if (!isGitHubConfigured) {
    return NextResponse.json(
      { error: "GitHub integration is not configured on this deployment." },
      { status: 501 },
    );
  }

  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  if (!verifyGithubSignature(rawBody, signature, env.GITHUB_WEBHOOK_SECRET!)) {
    logger.error("github webhook signature verification failed");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const eventName = request.headers.get("x-github-event");
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  // Idempotency on GitHub's own delivery id: if GitHub retries a delivery
  // we didn't ack fast enough (or ack at all, on a transient failure), a
  // second attempt for the exact same delivery short-circuits here rather
  // than re-running ingestion. This is a *retry* guard, distinct from
  // `findOrCreatePendingReview`'s (pullRequestId, headSha) dedup, which
  // guards against duplicate *reviews* however the duplicate delivery
  // arrived (including a manual re-delivery, which gets a fresh delivery id).
  const deliveryId = request.headers.get("x-github-delivery");
  if (deliveryId) {
    const { isDuplicate } = await recordWebhookDelivery(deliveryId, eventName ?? "unknown");
    if (isDuplicate) {
      logger.info("ignoring duplicate github webhook delivery", { deliveryId, eventName });
      return NextResponse.json({ ok: true, duplicate: true });
    }
  }

  try {
    switch (eventName) {
      case "ping":
        break;
      case "installation": {
        const parsed = githubInstallationWebhookBodySchema.safeParse(payload);
        if (!parsed.success) return malformedPayload(eventName, parsed.error);
        await handleInstallationEvent(parsed.data);
        break;
      }
      case "installation_repositories": {
        const parsed = githubInstallationRepositoriesWebhookBodySchema.safeParse(payload);
        if (!parsed.success) return malformedPayload(eventName, parsed.error);
        await handleInstallationRepositoriesEvent(parsed.data);
        break;
      }
      case "pull_request": {
        const parsed = githubPullRequestWebhookBodySchema.safeParse(payload);
        if (!parsed.success) return malformedPayload(eventName, parsed.error);
        // Fast path only: verifies, validates, and durably enqueues a
        // `reviews` row (status='pending'). Never runs the AI pipeline
        // inline — see `handlePullRequestEvent`'s own doc comment and
        // `processPendingReviews` in src/server/github/ingest.ts.
        await handlePullRequestEvent(parsed.data);
        return NextResponse.json({ ok: true, queued: true }, { status: 202 });
      }
      default:
        logger.info("ignoring unhandled github webhook event", { eventName });
    }
  } catch (error) {
    // Return 500 so GitHub retries delivery — every write above is
    // upsert/idempotent-by-natural-key, so a retried delivery is safe.
    logger.error("github webhook handler failed", {
      eventName,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

/**
 * A payload that parsed as JSON but doesn't match the event's expected
 * shape — either GitHub changed its schema, or this isn't really a
 * GitHub delivery. Logged with the validation issues (not the raw body,
 * which may contain repository/user data) and rejected with 400 rather
 * than trusting a best-effort cast, which is how a malformed payload used
 * to reach the ingestion handlers directly.
 */
function malformedPayload(eventName: string | null, error: z.ZodError) {
  logger.error("malformed github webhook payload", {
    eventName,
    issues: error.issues,
  });
  return NextResponse.json({ error: "Malformed payload" }, { status: 400 });
}
