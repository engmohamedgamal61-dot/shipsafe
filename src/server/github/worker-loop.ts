import { logger } from "@/lib/logger";
import { processPendingReviews } from "./ingest";

/**
 * How often the in-process worker checks for queued reviews. Not
 * user-configurable — this is a poll cadence, not a cost/behavior knob
 * (unlike the AI_* env vars in src/lib/env.ts), so a hardcoded constant
 * keeps the env var surface from growing for something self-hosters don't
 * need to tune.
 */
const POLL_INTERVAL_MS = 3000;

let loopStarted = false;

/**
 * Starts the background review-queue worker for this process — see
 * `src/instrumentation.ts`, which is the only caller. Polling (rather
 * than, say, a Postgres LISTEN/NOTIFY channel) is deliberate: it's the
 * simplest mechanism that needs no extra infrastructure beyond the
 * Postgres this app already requires, and `claimNextPendingReview`'s
 * atomic claim makes it safe to run from multiple processes without any
 * coordination between them.
 */
export function startReviewQueueWorker(): void {
  if (loopStarted) return;
  loopStarted = true;

  const tick = async () => {
    try {
      const { processed } = await processPendingReviews();
      if (processed > 0) {
        logger.info("review queue worker processed jobs", { processed });
      }
    } catch (error) {
      // A tick failing (e.g. a transient DB connection error) must not
      // kill the loop — the next tick tries again. Individual review
      // failures are already handled (and fail closed) inside
      // processPendingReviews/processClaimedReview; this only catches
      // something breaking outside that, like claimNextPendingReview
      // itself throwing.
      logger.error("review queue worker tick failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setTimeout(tick, POLL_INTERVAL_MS);
    }
  };

  void tick();
}
