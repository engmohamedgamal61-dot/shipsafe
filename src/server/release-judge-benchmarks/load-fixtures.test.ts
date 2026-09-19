import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverFixtureDirs, loadFixture, validateAllFixtures } from "./load-fixtures";

describe("discoverFixtureDirs / validateAllFixtures (real fixtures)", () => {
  it("discovers exactly the 10 Phase 1 fixtures", () => {
    expect(discoverFixtureDirs()).toHaveLength(10);
  });

  it("every real fixture validates with zero errors", () => {
    const results = validateAllFixtures();
    for (const r of results) expect(r.errors, r.fixtureDir).toEqual([]);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it("discovery is sorted deterministically", () => {
    const dirs = discoverFixtureDirs();
    expect(dirs).toEqual([...dirs].sort());
  });
});

describe("validateFixture / loadFixture (synthetic error cases)", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("throws for invalid JSON", () => {
    dir = mkdtempSync(path.join(tmpdir(), "release-judge-bench-test-"));
    writeFileSync(path.join(dir, "expected.json"), "{not valid json");
    expect(() => loadFixture(dir)).toThrow(/not valid JSON/);
  });

  it("throws for a manifest that fails schema validation", () => {
    dir = mkdtempSync(path.join(tmpdir(), "release-judge-bench-test-"));
    writeFileSync(path.join(dir, "expected.json"), "{}");
    expect(() => loadFixture(dir)).toThrow();
  });
});
