import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `src/lib/env.ts` parses `process.env` as a module-level side effect, so
 * each case needs a fresh module instance (`vi.resetModules()`) after
 * setting env vars — a plain import only sees the environment as of the
 * first import anywhere in the run.
 */
async function loadEnv() {
  vi.resetModules();
  return import("./env");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isAnthropicConfigured", () => {
  it("is false and AI_PROVIDER defaults to mock when nothing is set — mock mode needs zero AI env vars", async () => {
    const { env, isAnthropicConfigured } = await loadEnv();
    expect(env.AI_PROVIDER).toBe("mock");
    expect(isAnthropicConfigured).toBe(false);
  });

  it("falls back to false when AI_PROVIDER=anthropic is set without a key", async () => {
    vi.stubEnv("AI_PROVIDER", "anthropic");
    vi.stubEnv("ANTHROPIC_API_KEY", undefined);
    const { isAnthropicConfigured } = await loadEnv();
    expect(isAnthropicConfigured).toBe(false);
  });

  it("is true once both AI_PROVIDER=anthropic and an API key are set", async () => {
    vi.stubEnv("AI_PROVIDER", "anthropic");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test-key");
    const { isAnthropicConfigured } = await loadEnv();
    expect(isAnthropicConfigured).toBe(true);
  });

  it("defaults ANTHROPIC_MODEL and the cost-control ceilings without requiring them to be set", async () => {
    const { env } = await loadEnv();
    expect(env.ANTHROPIC_MODEL).toBe("claude-sonnet-5");
    expect(env.AI_MAX_TOKENS_PER_REVIEWER).toBeGreaterThan(0);
    expect(env.AI_REQUEST_TIMEOUT_MS).toBeGreaterThan(0);
    expect(env.AI_MAX_CONCURRENT_REVIEWERS).toBeGreaterThan(0);
  });
});
