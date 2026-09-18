/**
 * Runs once when a new Next.js server instance boots, before it handles
 * any request — see docs/ARCHITECTURE.md § Background Review Worker and
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md.
 *
 * Starts the in-process background worker that drains the review queue
 * (`reviews` rows with status='pending'/stale 'running') — see
 * src/server/github/worker-loop.ts. This is what lets the GitHub webhook
 * Route Handler stay fast: it only ever enqueues a review, never runs the
 * AI pipeline itself.
 */
export async function register(): Promise<void> {
  // Edge runtime has no persistent timers / long-lived process — only
  // start the poller in the Node.js runtime (the Route Handlers this
  // worker exists for are Node runtime too).
  if (process.env.NEXT_RUNTIME === "edge") return;

  const { isGitHubConfigured } = await import("@/lib/env");
  if (!isGitHubConfigured) return; // nothing to poll for without real GitHub ingestion

  const { startReviewQueueWorker } = await import("@/server/github/worker-loop");
  startReviewQueueWorker();
}
