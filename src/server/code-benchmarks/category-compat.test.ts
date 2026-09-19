import { describe, expect, it } from "vitest";
import { LEGACY_CATEGORY_MAP, normalizeCategory } from "./category-compat";

describe("normalizeCategory", () => {
  it("maps a legacy, ambiguous domain-only category to the generic canonical subcategory", () => {
    expect(normalizeCategory("correctness")).toBe("correctness.generic");
    expect(normalizeCategory("performance")).toBe("performance.generic");
  });

  it("maps a legacy, unambiguous category to its specific canonical subcategory", () => {
    expect(normalizeCategory("off-by-one")).toBe("correctness.off-by-one");
    expect(normalizeCategory("missing-await")).toBe("concurrency.missing-await");
    expect(normalizeCategory("duplication")).toBe("maintainability.duplication");
  });

  it("returns undefined for an unknown category — never guesses", () => {
    expect(normalizeCategory("something-nobody-ever-heard-of")).toBeUndefined();
  });

  it("returns undefined for a category already in canonical domain.subcategory format", () => {
    expect(normalizeCategory("correctness.off-by-one")).toBeUndefined();
  });

  it("is case-sensitive and does not fuzzy-match", () => {
    expect(normalizeCategory("Off-By-One")).toBeUndefined();
    expect(normalizeCategory("OFF-BY-ONE")).toBeUndefined();
  });

  it("every mapped value is itself in the canonical domain.subcategory format", () => {
    const canonicalPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*\.[a-z0-9]+(?:-[a-z0-9]+)*$/;
    for (const [legacy, canonical] of Object.entries(LEGACY_CATEGORY_MAP)) {
      expect(canonical, `mapping for "${legacy}"`).toMatch(canonicalPattern);
    }
  });
});
