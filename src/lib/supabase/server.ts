import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import type { Database } from "./types";

/**
 * Server-side Supabase client bound to the current request's cookies.
 * Only call this when `isSupabaseConfigured` is true — see
 * `src/lib/env.ts`.
 */
export async function createServerSupabaseClient() {
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    throw new Error(
      "createServerSupabaseClient() called without Supabase configured — check isSupabaseConfigured first",
    );
  }
  const cookieStore = await cookies();

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components can't set cookies — this is only safe to
            // ignore because nothing here depends on the write landing.
            // TODO(Phase 2, pre-launch): there is no `proxy.ts` yet
            // refreshing the session on every request, so a session
            // nearing expiry will not actually get refreshed by this
            // catch block the way the standard Supabase SSR pattern
            // assumes. Add `src/proxy.ts` (Next.js 16's renamed
            // middleware — see docs/ARCHITECTURE.md § Auth) before
            // relying on long-lived configured-mode sessions.
          }
        },
      },
    },
  );
}
