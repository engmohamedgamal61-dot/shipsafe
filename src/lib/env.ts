import { z } from "zod";

/**
 * Validated environment. Supabase and GitHub App vars are optional —
 * their absence is what puts the app into demo mode / disables GitHub
 * integration (see docs/ARCHITECTURE.md). Everything else is required
 * with a safe default so `npm run build` never fails on a missing env
 * var in a fresh checkout.
 *
 * Nothing here is specific to any one deployment: every self-hoster sets
 * their own Supabase project, their own GitHub App, and their own
 * secrets. There is no "ShipSafe's own" instance of any of these.
 */
const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),

  // General-purpose app secret: signs the demo-session cookie AND the
  // short-lived GitHub-install "state" token (see
  // src/server/github/install-state.ts). One secret, not two, to keep
  // the self-hosting env var list short.
  APP_SECRET: z.string().min(1).default("shipsafe-app-secret-dev-only"),

  // --- GitHub App (optional — enables real repo/PR ingestion) ---
  // Create your own GitHub App (github.com/settings/apps/new); see
  // docs/GITHUB_INTEGRATION.md. All four must be set together to
  // activate GitHub integration.
  GITHUB_APP_ID: z.string().min(1).optional(),
  GITHUB_APP_SLUG: z.string().min(1).optional(),
  // PEM contents. Most hosts don't let you paste real newlines into an
  // env var, so this accepts the key with literal "\n" sequences and
  // un-escapes them — see `githubAppPrivateKey` below.
  GITHUB_APP_PRIVATE_KEY: z.string().min(1).optional(),
  GITHUB_WEBHOOK_SECRET: z.string().min(1).optional(),

  // --- AI provider (optional — defaults to the deterministic mock) ---
  // Every self-hoster brings their own Anthropic account; there is no
  // "ShipSafe's own" key. See docs/ARCHITECTURE.md § AI Provider.
  AI_PROVIDER: z.enum(["mock", "anthropic"]).default("mock"),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_MODEL: z.string().min(1).default("claude-sonnet-5"),
  // Cost/usage ceilings — see docs/ARCHITECTURE.md § Cost & Usage Control.
  AI_MAX_TOKENS_PER_REVIEWER: z.coerce.number().int().positive().default(4096),
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  AI_MAX_CONCURRENT_REVIEWERS: z.coerce.number().int().positive().default(3),

  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});

const parsed = envSchema.safeParse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  APP_SECRET: process.env.APP_SECRET,
  GITHUB_APP_ID: process.env.GITHUB_APP_ID,
  GITHUB_APP_SLUG: process.env.GITHUB_APP_SLUG,
  GITHUB_APP_PRIVATE_KEY: process.env.GITHUB_APP_PRIVATE_KEY,
  GITHUB_WEBHOOK_SECRET: process.env.GITHUB_WEBHOOK_SECRET,
  AI_PROVIDER: process.env.AI_PROVIDER,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL,
  AI_MAX_TOKENS_PER_REVIEWER: process.env.AI_MAX_TOKENS_PER_REVIEWER,
  AI_REQUEST_TIMEOUT_MS: process.env.AI_REQUEST_TIMEOUT_MS,
  AI_MAX_CONCURRENT_REVIEWERS: process.env.AI_MAX_CONCURRENT_REVIEWERS,
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

/**
 * True when a GitHub App is configured. GitHub integration additionally
 * requires Supabase (real PR ingestion needs a real workspace/database to
 * write into — there is nothing to attach a GitHub installation to in
 * demo mode). See `src/server/github/`.
 */
export const isGitHubConfigured = Boolean(
  isSupabaseConfigured &&
    env.SUPABASE_SERVICE_ROLE_KEY &&
    env.GITHUB_APP_ID &&
    env.GITHUB_APP_SLUG &&
    env.GITHUB_APP_PRIVATE_KEY &&
    env.GITHUB_WEBHOOK_SECRET,
);

/**
 * True when `AI_PROVIDER=anthropic` AND a key is actually present. If
 * `AI_PROVIDER=anthropic` is set without a key, the composition root falls
 * back to the mock provider rather than silently sending unauthenticated
 * requests — see `src/server/container.ts`.
 */
export const isAnthropicConfigured = Boolean(
  env.AI_PROVIDER === "anthropic" && env.ANTHROPIC_API_KEY,
);

/** The GitHub App's PEM private key, with escaped `\n` sequences un-escaped. */
export function githubAppPrivateKey(): string {
  if (!env.GITHUB_APP_PRIVATE_KEY) {
    throw new Error("githubAppPrivateKey() called without GITHUB_APP_PRIVATE_KEY set");
  }
  return env.GITHUB_APP_PRIVATE_KEY.includes("\\n")
    ? env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n")
    : env.GITHUB_APP_PRIVATE_KEY;
}
