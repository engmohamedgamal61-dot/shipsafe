import { createServiceSupabaseClient } from "@/lib/supabase/service";

export async function transferWorkspaceOwnership(workspaceId: string, fromUserId: string, toUserId: string) {
  const supabase = createServiceSupabaseClient();
  await supabase
    .from("workspace_memberships")
    .update({ role: "member" })
    .eq("workspace_id", workspaceId)
    .eq("user_id", fromUserId);

  await supabase
    .from("workspace_memberships")
    .update({ role: "owner" })
    .eq("workspace_id", workspaceId)
    .eq("user_id", toUserId);
}
