import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BENCHMARK_ROOT, discoverFixtureDirs, loadFixture, validateAllFixtures, validateFixture } from "./load-fixtures";

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

  it("loadFixture reads every declared file's source text", () => {
    const dir = path.join(BENCHMARK_ROOT, "layer-boundaries", "01-repository-imports-ui-component");
    const fixture = loadFixture(dir);
    expect(fixture.sourceFiles["supabase-adapter.ts"]).toContain("RepositoryCard");
  });

  it("loadFixture handles a multi-file fixture", () => {
    const dir = path.join(BENCHMARK_ROOT, "circular-dependency", "01-mutual-imports-between-services");
    const fixture = loadFixture(dir);
    expect(Object.keys(fixture.sourceFiles).sort()).toEqual(["ingest.ts", "seed.ts"]);
  });
});

describe("validateFixture (synthetic error cases)", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("reports invalid JSON without throwing", () => {
    dir = mkdtempSync(path.join(tmpdir(), "arch-bench-test-"));
    writeFileSync(path.join(dir, "expected.json"), "{not valid json");
    const result = validateFixture(dir);
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.message).toMatch(/not valid JSON/);
  });

  it("reports a hallucinated fixture file path (declared but missing on disk)", () => {
    dir = mkdtempSync(path.join(tmpdir(), "arch-bench-test-"));
    mkdirSync(path.join(dir, "fixture"));
    writeFileSync(
      path.join(dir, "expected.json"),
      JSON.stringify({
        fixture_id: "synthetic-01",
        domain: "layer-boundaries",
        tags: ["safe"],
        description: "x",
        files: ["missing.ts"],
        expected: { needs_more_context_acceptable: false, allowed_categories: [], prohibited_categories: [], required_findings: [], optional_findings: [] },
      }),
    );
    const result = validateFixture(dir);
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.message).toMatch(/hallucinated fixture file path/);
  });

  it("loadFixture throws for an invalid fixture", () => {
    dir = mkdtempSync(path.join(tmpdir(), "arch-bench-test-"));
    writeFileSync(path.join(dir, "expected.json"), "{}");
    expect(() => loadFixture(dir)).toThrow();
  });
});
