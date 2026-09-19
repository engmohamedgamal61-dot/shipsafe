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
import { claimWebhookDelivery, markWebhookDeliveryCompleted } from "@/server/github/writes";
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
  //
  // Audit fix for v1 HIGH-1: the delivery is only marked PERMANENTLY
  // deduplicated after the handler below succeeds
  // (`markWebhookDeliveryCompleted`), not at claim time — a delivery
  // whose processing throws stays retryable under the same delivery id
  // rather than being silently dropped on GitHub's redelivery.
  const deliveryId = request.headers.get("x-github-delivery");
  if (deliveryId) {
    const claim = await claimWebhookDelivery(deliveryId, eventName ?? "unknown");
    if (claim !== "claimed") {
      logger.info("ignoring duplicate or in-progress github webhook delivery", { deliveryId, eventName, claim });
      return NextResponse.json({ ok: true, duplicate: true });
    }
  }

  try {
    let response = NextResponse.json({ ok: true });

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
        response = NextResponse.json({ ok: true, queued: true }, { status: 202 });
        break;
      }
      default:
        logger.info("ignoring unhandled github webhook event", { eventName });
    }

    if (deliveryId) await markWebhookDeliveryCompleted(deliveryId);
    return response;
  } catch (error) {
    // Return 500 so GitHub retries delivery with the SAME delivery id —
    // `claimWebhookDelivery` never marked it completed, so that retry
    // will be reprocessed rather than dropped. Every write above is also
    // upsert/idempotent-by-natural-key, so a retry is safe either way.
    logger.error("github webhook handler failed", {
      eventName,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
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
