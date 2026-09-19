import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { claimNextPendingReview } from "@/server/github/writes";

/**
 * Background worker loop: repeatedly claims the oldest pending review
 * row (an atomic, race-safe DB claim — see claimNextPendingReview) and
 * runs it through the review engine. The caller here is never an
 * end user's request — it's a fixed poll loop started once per server
 * process from src/instrumentation.ts.
 */
export async function processNextClaimedReview(): Promise<void> {
  const claimed = await claimNextPendingReview();
  if (!claimed) return;

  const supabase = createServiceSupabaseClient();

  await supabase
    .from("reviews")
    .update({ status: "running" })
    .eq("id", claimed.id);

  // ... run the orchestrator against claimed.pullRequestId, then
  // completeReview(claimed.id, result) — omitted, not relevant to this
  // fixture.
}
