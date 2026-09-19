import { describe, expect, it } from "vitest";
import { normalizeCategory } from "./category-compat";

describe("normalizeCategory", () => {
  it("maps a whole-domain legacy string to that domain's generic bucket", () => {
    expect(normalizeCategory("layering")).toBe("layer-boundaries.generic");
    expect(normalizeCategory("coupling")).toBe("coupling.generic");
    expect(normalizeCategory("duplication")).toBe("duplication.generic");
  });

  it("maps a specific legacy string directly to its specific canonical category", () => {
    expect(normalizeCategory("circular-import")).toBe("circular-dependency.mutual-module-imports");
    expect(normalizeCategory("port-bypass")).toBe("coupling.bypasses-port-abstraction");
    expect(normalizeCategory("vendor-lock-in")).toBe("provider-leakage.vendor-type-in-domain");
  });

  it("returns undefined for an unrecognized category — no fuzzy matching", () => {
    expect(normalizeCategory("some-made-up-category")).toBeUndefined();
  });

  it("returns undefined for an already-canonical category (nothing to normalize)", () => {
    expect(normalizeCategory("layer-boundaries.cross-layer-import")).toBeUndefined();
  });
});
