import { isSupabaseConfigured } from "@/lib/env";
import type { AuthPort } from "./auth/types";
import { DemoAuthAdapter } from "./auth/demo-adapter";
import { SupabaseAuthAdapter } from "./auth/supabase-adapter";
import type { ReviewRepository } from "./repositories/ports";
import { InMemoryReviewRepository } from "./repositories/in-memory-adapter";
import { SupabaseReviewRepository } from "./repositories/supabase-adapter";

/**
 * Composition root: the ONLY place in the app that decides which adapter
 * backs each port, based on whether Supabase is configured. Everything
 * else — routes, actions, components — depends on the port types, never
 * on a concrete adapter. See docs/ARCHITECTURE.md § Ports & Adapters.
 */
export function getAuth(): AuthPort {
  return isSupabaseConfigured ? new SupabaseAuthAdapter() : new DemoAuthAdapter();
}

export function getReviewRepository(): ReviewRepository {
  return isSupabaseConfigured
    ? new SupabaseReviewRepository()
    : new InMemoryReviewRepository();
}
