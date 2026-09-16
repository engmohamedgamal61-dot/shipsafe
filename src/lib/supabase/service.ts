import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import type { Database } from "./types";

/**
 * Service-role Supabase client. This is the ONLY sanctioned way trusted
 * backend code writes to `pull_requests`, `reviews`, `reviewer_runs`, and
 * `findings` — those tables have no INSERT/UPDATE/DELETE policy for the
 * `authenticated` role at all (see supabase/migrations/0001_init.sql and
 * docs/ARCHITECTURE.md § Server-Authoritative Writes), so a write through
 * a user-session client is rejected by RLS regardless of who the user is.
 *
 * NEVER import this from a Server Action or Route Handler that forwards
 * arbitrary client input directly into a write — it bypasses RLS
 * entirely, so the *code path* is what has to enforce correctness (e.g.
 * "this review belongs to a PR in a repository the caller's workspace
 * owns") before calling it. Phase 1 has no writer yet (no live GitHub
 * ingestion); this is the client Phase 2's ingestion/orchestration
 * service will use.
 */
export function createServiceSupabaseClient() {
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "createServiceSupabaseClient() called without SUPABASE_SERVICE_ROLE_KEY configured",
    );
  }
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
