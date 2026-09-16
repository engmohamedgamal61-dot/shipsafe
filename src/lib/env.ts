import { z } from "zod";

/**
 * Validated environment. Supabase vars are optional — their absence is
 * what puts the app into demo mode (see docs/ARCHITECTURE.md). Everything
 * else is required with a safe default so `npm run build` never fails on
 * a missing env var in a fresh checkout.
 */
const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  DEMO_SESSION_SECRET: z.string().min(1).default("shipsafe-demo-secret-dev-only"),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});

const parsed = envSchema.safeParse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  DEMO_SESSION_SECRET: process.env.DEMO_SESSION_SECRET,
  NODE_ENV: process.env.NODE_ENV,
});

if (!parsed.success) {
  throw new Error(
    `Invalid environment configuration: ${parsed.error.message}`,
  );
}

export const env = parsed.data;

/**
 * True when Supabase is configured. When false, the composition root
 * (`src/server/container.ts`) selects in-memory demo adapters instead of
 * Supabase-backed ones.
 */
export const isSupabaseConfigured = Boolean(
  env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);
