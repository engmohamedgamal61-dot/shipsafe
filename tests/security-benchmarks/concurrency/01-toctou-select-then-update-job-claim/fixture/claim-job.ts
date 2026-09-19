import { createServiceSupabaseClient } from "@/lib/supabase/service";

/**
 * Claims the oldest pending export job for this worker to process.
 * Called concurrently by every worker instance on a shared poll loop.
 */
export async function claimNextExportJob(): Promise<string | null> {
  const supabase = createServiceSupabaseClient();

  const { data: candidate } = await supabase
    .from("export_jobs")
    .select("id")
    .eq("status", "pending")
    .order("queued_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!candidate) return null;

  const { data: claimed } = await supabase
    .from("export_jobs")
    .update({ status: "running" })
    .eq("id", candidate.id)
    .select("id")
    .maybeSingle();

  return claimed?.id ?? null;
}
