import { describe, expect, it } from "vitest";
import { LEGACY_CATEGORY_MAP, normalizeCategory } from "./category-compat";

describe("normalizeCategory", () => {
  it("maps a legacy, ambiguous domain-only category to the generic canonical subcategory", () => {
    expect(normalizeCategory("access-control")).toBe("access-control.generic");
    expect(normalizeCategory("webhook-security")).toBe("webhook.generic");
  });

  it("maps a legacy, unambiguous category to its specific canonical subcategory", () => {
    expect(normalizeCategory("sql-injection")).toBe("injection.sql");
    expect(normalizeCategory("rls")).toBe("database.rls");
    expect(normalizeCategory("prompt-injection")).toBe("llm.prompt-injection");
  });

  it("maps both 'broken-auth' and 'broken-authentication' to the same canonical category (Task: fix confirmed scorer defects, item 3)", () => {
    expect(normalizeCategory("broken-auth")).toBe("auth.broken-authentication");
    expect(normalizeCategory("broken-authentication")).toBe("auth.broken-authentication");
  });

  it("returns undefined for an unknown category — never guesses", () => {
    expect(normalizeCategory("something-nobody-ever-heard-of")).toBeUndefined();
  });

  it("returns undefined for a category already in canonical domain.subcategory format (not this layer's job)", () => {
    expect(normalizeCategory("access-control.idor")).toBeUndefined();
  });

  it("is case-sensitive and does not fuzzy-match", () => {
    expect(normalizeCategory("Access-Control")).toBeUndefined();
    expect(normalizeCategory("ACCESS-CONTROL")).toBeUndefined();
  });

  it("every mapped value is itself in the canonical domain.subcategory format", () => {
    const canonicalPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*\.[a-z0-9]+(?:-[a-z0-9]+)*$/;
    for (const [legacy, canonical] of Object.entries(LEGACY_CATEGORY_MAP)) {
      expect(canonical, `mapping for "${legacy}"`).toMatch(canonicalPattern);
    }
  });
});
