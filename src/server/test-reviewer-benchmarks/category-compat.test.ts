import { describe, expect, it } from "vitest";
import { normalizeCategory } from "./category-compat";

describe("normalizeCategory", () => {
  it("maps a whole-domain legacy string to that domain's generic bucket", () => {
    expect(normalizeCategory("missing-tests")).toBe("missing-tests.generic");
    expect(normalizeCategory("mocking")).toBe("mock-fidelity.generic");
    expect(normalizeCategory("weak-assertion")).toBe("weak-assertions.generic");
  });

  it("maps a specific legacy string directly to its specific canonical category", () => {
    expect(normalizeCategory("missing-await")).toBe("async-mistakes.missing-await");
    expect(normalizeCategory("tautological")).toBe("weak-assertions.tautological");
    expect(normalizeCategory("over-mocking")).toBe("mock-fidelity.hides-real-contract");
  });

  it("returns undefined for an unrecognized category — no fuzzy matching", () => {
    expect(normalizeCategory("some-made-up-category")).toBeUndefined();
  });

  it("returns undefined for an already-canonical category (nothing to normalize)", () => {
    expect(normalizeCategory("missing-tests.critical-behavior")).toBeUndefined();
  });
});
