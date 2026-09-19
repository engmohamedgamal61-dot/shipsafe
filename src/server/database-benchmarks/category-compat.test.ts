import { describe, expect, it } from "vitest";
import { normalizeCategory } from "./category-compat";

describe("normalizeCategory", () => {
  it("maps a whole-domain legacy string to that domain's generic bucket", () => {
    expect(normalizeCategory("foreign-key")).toBe("foreign-keys.generic");
    expect(normalizeCategory("cascade")).toBe("cascade-delete.generic");
    expect(normalizeCategory("performance")).toBe("performance.generic");
  });

  it("maps a specific legacy string directly to its specific canonical category", () => {
    expect(normalizeCategory("missing-unique-constraint")).toBe("race-condition.missing-unique-constraint");
    expect(normalizeCategory("n-plus-one")).toBe("performance.n-plus-one");
    expect(normalizeCategory("unsafe-cascade")).toBe("cascade-delete.unsafe-cascade");
  });

  it("maps real-world synonyms observed in the first live baseline run (regression)", () => {
    expect(normalizeCategory("database-migration")).toBe("migration-safety.generic");
    expect(normalizeCategory("database-migration-safety")).toBe("migration-safety.generic");
    expect(normalizeCategory("database-indexing")).toBe("performance.generic");
  });

  it("returns undefined for an unrecognized category — no fuzzy matching", () => {
    expect(normalizeCategory("some-made-up-category")).toBeUndefined();
  });

  it("returns undefined for an already-canonical category (nothing to normalize)", () => {
    expect(normalizeCategory("foreign-keys.missing-reference")).toBeUndefined();
  });
});
