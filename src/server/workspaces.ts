import { isSupabaseConfigured } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { workspaceIdForUser as demoWorkspaceIdForUser } from "@/server/demo/seed";

/**
 * The workspace a user's actions (like connecting a GitHub repo) should
 * apply to. Phase 1/2 give every user exactly one workspace — created
 * automatically at sign-up (see `handle_new_user` in
 * `supabase/migrations/0002_github_integration.sql`) in configured mode,
 * or the single seeded demo workspace in demo mode. There is no
 * workspace switcher yet; this is the one place that 1:1 assumption
 * lives, so introducing multi-workspace support later is a change to
 * this function, not every call site.
 */
export async function getPrimaryWorkspaceId(userId: string): Promise<string | null> {
  if (!isSupabaseConfigured) {
    return demoWorkspaceIdForUser(userId);
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("workspace_memberships")
    .select("workspace_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (error) return null;
  return data?.workspace_id ?? null;
}
