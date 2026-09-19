import { createServiceSupabaseClient } from "@/lib/supabase/service";

export async function attachLatestReviewStatus(pullRequests: { id: string }[]) {
  const supabase = createServiceSupabaseClient();
  const results = [];
  for (const pr of pullRequests) {
    const { data } = await supabase
      .from("reviews")
      .select("status")
      .eq("pull_request_id", pr.id)
      .order("opened_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    results.push({ ...pr, status: data?.status ?? null });
  }
  return results;
}
