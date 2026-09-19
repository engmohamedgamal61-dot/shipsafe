import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BENCHMARK_ROOT, discoverFixtureDirs, loadFixture, validateAllFixtures, validateFixture } from "./load-fixtures";

function validManifest(overrides: Record<string, unknown> = {}) {
  return {
    fixture_id: "test-01-example",
    domain: "test",
    tags: ["vulnerable"],
    spec_ref: "3.1",
    description: "A minimal valid fixture used only by load-fixtures.test.ts.",
    files: ["main.ts"],
    expected: {
      needs_more_context_acceptable: false,
      allowed_categories: ["access-control.idor"],
      prohibited_categories: [],
      required_findings: [
        {
          id: "req-1",
          rule_id: "SEC-AUTHZ-001",
          files: ["main.ts"],
          severity_range: ["P0", "P0"],
          confidence_range: ["high", "high"],
          exploit_preconditions: "None.",
        },
      ],
    },
    ...overrides,
  };
}

/** Builds a scratch fixture directory under a fresh tmpdir, returning its path. */
function makeFixtureDir(options: {
  manifest?: unknown;
  manifestRaw?: string;
  sourceFiles?: Record<string, string>;
}): string {
  const root = mkdtempSync(path.join(tmpdir(), "shipsafe-benchmark-fixture-"));
  const manifestJson = options.manifestRaw ?? JSON.stringify(options.manifest ?? validManifest());
  writeFileSync(path.join(root, "expected.json"), manifestJson, "utf8");

  const sourceRoot = path.join(root, "fixture");
  mkdirSync(sourceRoot, { recursive: true });
  const sourceFiles = options.sourceFiles ?? { "main.ts": "export const x = 1;\n" };
  for (const [relativePath, content] of Object.entries(sourceFiles)) {
    writeFileSync(path.join(sourceRoot, relativePath), content, "utf8");
  }

  return root;
}

const scratchDirs: string[] = [];
function trackedFixtureDir(options: Parameters<typeof makeFixtureDir>[0]): string {
  const dir = makeFixtureDir(options);
  scratchDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (scratchDirs.length > 0) {
    const dir = scratchDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("validateFixture", () => {
  it("accepts a well-formed fixture whose declared files all exist on disk", () => {
    const dir = trackedFixtureDir({});
    const result = validateFixture(dir);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.fixtureId).toBe("test-01-example");
  });

  it("rejects a fixture whose expected.json is not valid JSON", () => {
    const dir = trackedFixtureDir({ manifestRaw: "{ not: valid json" });
    const result = validateFixture(dir);
    expect(result.ok).toBe(false);
    expect(result.manifest).toBeNull();
    expect(result.errors[0]?.message).toMatch(/not valid JSON/);
  });

  it("rejects a fixture whose manifest fails schema validation", () => {
    const dir = trackedFixtureDir({ manifest: validManifest({ tags: [] }) });
    const result = validateFixture(dir);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects a fixture that declares a file which does not exist under fixture/ (hallucinated file path)", () => {
    const dir = trackedFixtureDir({
      manifest: validManifest({ files: ["main.ts", "does-not-exist.ts"] }),
    });
    const result = validateFixture(dir);
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.message.includes("hallucinated fixture file path"))).toBe(
      true,
    );
    expect(result.errors.some((error) => error.message.includes("does-not-exist.ts"))).toBe(true);
  });

  it("still surfaces a fixture_id (best-effort) for a schema-invalid manifest, for error reporting", () => {
    const dir = trackedFixtureDir({ manifest: validManifest({ tags: [] }) });
    const result = validateFixture(dir);
    expect(result.fixtureId).toBe("test-01-example");
  });
});

describe("loadFixture", () => {
  it("loads source file contents for a valid fixture", () => {
    const dir = trackedFixtureDir({ sourceFiles: { "main.ts": "export const x = 42;\n" } });
    const loaded = loadFixture(dir);
    expect(loaded.sourceFiles["main.ts"]).toBe("export const x = 42;\n");
    expect(loaded.manifest.fixture_id).toBe("test-01-example");
  });

  it("throws for an invalid fixture instead of returning a partial result", () => {
    const dir = trackedFixtureDir({ manifest: validManifest({ files: ["missing.ts"] }) });
    expect(() => loadFixture(dir)).toThrow(/Invalid fixture/);
  });
});

describe("discoverFixtureDirs", () => {
  it("finds every directory containing an expected.json, sorted deterministically", () => {
    const root = mkdtempSync(path.join(tmpdir(), "shipsafe-benchmark-root-"));
    scratchDirs.push(root);

    for (const slug of ["b-fixture", "a-fixture"]) {
      const dir = path.join(root, "domain", slug);
      mkdirSync(path.join(dir, "fixture"), { recursive: true });
      writeFileSync(path.join(dir, "expected.json"), JSON.stringify(validManifest()), "utf8");
      writeFileSync(path.join(dir, "fixture", "main.ts"), "export const x = 1;\n", "utf8");
    }

    const dirs = discoverFixtureDirs(root);
    expect(dirs).toHaveLength(2);
    expect(dirs).toEqual([...dirs].sort());
  });

  it("does not descend into underscore- or dot-prefixed directories", () => {
    const root = mkdtempSync(path.join(tmpdir(), "shipsafe-benchmark-root-"));
    scratchDirs.push(root);
    mkdirSync(path.join(root, "_scratch", "nested"), { recursive: true });
    writeFileSync(path.join(root, "_scratch", "nested", "expected.json"), JSON.stringify(validManifest()), "utf8");

    const dirs = discoverFixtureDirs(root);
    expect(dirs).toEqual([]);
  });
});

describe("validateAllFixtures against the real benchmark suite", () => {
  it("every fixture under tests/security-benchmarks/ is well-formed (BENCHMARK_ROOT smoke test)", () => {
    expect(BENCHMARK_ROOT.endsWith(path.join("tests", "security-benchmarks"))).toBe(true);

    const results = validateAllFixtures();
    const failures = results.filter((result) => !result.ok);

    if (failures.length > 0) {
      const detail = failures
        .map(
          (failure) =>
            `${failure.fixtureId ?? failure.fixtureDir}: ${failure.errors.map((e) => `${e.path}: ${e.message}`).join("; ")}`,
        )
        .join("\n");
      throw new Error(`${failures.length} fixture(s) failed validation:\n${detail}`);
    }

    expect(results.length).toBeGreaterThanOrEqual(10);
  });
});
