import { afterEach, describe, expect, it, vi } from "vitest";
import { isReviewStale } from "./staleness";

describe("isReviewStale", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns true once the staleness threshold has elapsed", () => {
    vi.setSystemTime(new Date("2026-01-02T00:00:00Z"));
    const result = isReviewStale({ completedAt: "2026-01-01T00:00:00Z" });
    expect(result).toBe(true);
  });

  it("returns false before the staleness threshold", () => {
    vi.setSystemTime(new Date("2026-01-01T01:00:00Z"));
    const result = isReviewStale({ completedAt: "2026-01-01T00:00:00Z" });
    expect(result).toBe(false);
  });
});
