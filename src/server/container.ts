import { env, isAnthropicConfigured, isSupabaseConfigured } from "@/lib/env";
import type { AuthPort } from "./auth/types";
import { DemoAuthAdapter } from "./auth/demo-adapter";
import { SupabaseAuthAdapter } from "./auth/supabase-adapter";
import type { ReviewRepository } from "./repositories/ports";
import { InMemoryReviewRepository } from "./repositories/in-memory-adapter";
import { SupabaseReviewRepository } from "./repositories/supabase-adapter";
import type { AIProvider } from "./review-engine/providers/provider";
import { MockAIProvider } from "./review-engine/providers/mock-provider";
import { AnthropicProvider } from "./review-engine/providers/anthropic-provider";
import type { ReleaseJudgePort } from "./review-engine/providers/judge-provider";
import { MockReleaseJudgeProvider, AnthropicJudgeProvider } from "./review-engine/providers/judge-provider";

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

/**
 * Real GitHub PR ingestion only (`src/server/github/ingest.ts`) — the demo
 * review (`src/server/demo/seed.ts`) always hardcodes `MockAIProvider`
 * regardless of `AI_PROVIDER`, so the demo stays deterministic no matter
 * how a self-hoster has configured their own deployment.
 */
export function getAIProvider(): AIProvider {
  return isAnthropicConfigured && env.ANTHROPIC_API_KEY
    ? new AnthropicProvider(env.ANTHROPIC_API_KEY)
    : new MockAIProvider();
}

export function getReleaseJudgePort(): ReleaseJudgePort {
  return isAnthropicConfigured && env.ANTHROPIC_API_KEY
    ? new AnthropicJudgeProvider(env.ANTHROPIC_API_KEY)
    : new MockReleaseJudgeProvider();
}
