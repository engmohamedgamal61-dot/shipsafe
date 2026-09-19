import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { expectedFixtureSchema, type ExpectedFixture } from "./schema";

/**
 * Root of the benchmark fixture tree — see
 * `docs/agents/security-benchmark-plan.md` §5.1. Not under `src/`: these
 * are inert JSON manifests plus illustrative source snippets consumed by
 * benchmark tooling, never by the production app (see
 * `tests/security-benchmarks/README.md` and the matching excludes in
 * `tsconfig.json`/`eslint.config.mjs`).
 */
export const BENCHMARK_ROOT = path.resolve(process.cwd(), "tests/security-benchmarks");

export interface FixtureValidationError {
  /** Which part of the fixture failed — a schema field path, or a specific file reference. */
  path: string;
  message: string;
}

export interface FixtureValidationResult {
  ok: boolean;
  fixtureDir: string;
  fixtureId: string | null;
  manifest: ExpectedFixture | null;
  errors: FixtureValidationError[];
}

function bestEffortFixtureId(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null || !("fixture_id" in raw)) return null;
  const value = (raw as Record<string, unknown>).fixture_id;
  return typeof value === "string" ? value : null;
}

/**
 * Every directory (recursively) under `root` that directly contains an
 * `expected.json`, sorted for determinism — fixture discovery must never
 * depend on filesystem readdir ordering, which isn't guaranteed stable
 * across platforms.
 */
export function discoverFixtureDirs(root: string = BENCHMARK_ROOT): string[] {
  const found: string[] = [];

  function walk(dir: string): void {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      // `_`-prefixed (e.g. a future `_schema/`) and dotfiles are tooling,
      // never fixtures — don't walk into them.
      if (!entry.isDirectory() || entry.name.startsWith("_") || entry.name.startsWith(".")) {
        continue;
      }
      const full = path.join(dir, entry.name);
      if (existsSync(path.join(full, "expected.json"))) {
        found.push(full);
      } else {
        walk(full);
      }
    }
  }

  walk(root);
  return found.sort();
}

/**
 * Validates one fixture directory: parses `expected.json` against the
 * schema, then cross-checks every file path it declares actually exists
 * on disk under `fixture/`. A manifest can be schema-valid — every
 * required field present, internally consistent — and still reference a
 * file that was never created; that's the hallucinated-path case this
 * function exists to catch, distinct from (and in addition to) the
 * schema's own referential-integrity checks (a `required_findings[]`
 * entry referencing a file not in the fixture's own `files` list, which
 * fails at the schema layer instead — see `schema.ts`).
 *
 * Never throws — always returns a result, so a caller can validate every
 * fixture in the suite and report every failure, not just the first one.
 */
export function validateFixture(fixtureDir: string): FixtureValidationResult {
  const manifestPath = path.join(fixtureDir, "expected.json");

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    return {
      ok: false,
      fixtureDir,
      fixtureId: null,
      manifest: null,
      errors: [
        {
          path: "expected.json",
          message: `not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }

  const parsed = expectedFixtureSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      fixtureDir,
      fixtureId: bestEffortFixtureId(raw),
      manifest: null,
      errors: parsed.error.issues.map((issue) => ({
        path: issue.path.length > 0 ? issue.path.join(".") : "(root)",
        message: issue.message,
      })),
    };
  }

  const manifest = parsed.data;
  const sourceRoot = path.join(fixtureDir, "fixture");
  const errors: FixtureValidationError[] = [];

  for (const relativeFile of manifest.files) {
    const absolute = path.join(sourceRoot, relativeFile);
    const exists = existsSync(absolute) && statSync(absolute).isFile();
    if (!exists) {
      errors.push({
        path: `files[${JSON.stringify(relativeFile)}]`,
        message: `expected.json declares "${relativeFile}" but no such file exists under ${path.relative(process.cwd(), sourceRoot)}/ — hallucinated fixture file path`,
      });
    }
  }

  return { ok: errors.length === 0, fixtureDir, fixtureId: manifest.fixture_id, manifest, errors };
}

export interface LoadedFixture {
  manifest: ExpectedFixture;
  fixtureDir: string;
  /** Every declared source file's contents, keyed by the same relative path used in the manifest. */
  sourceFiles: Record<string, string>;
}

/**
 * Validates and fully loads one fixture's source file contents. Throws
 * on an invalid fixture — call `validateFixture()` first if a
 * non-throwing check is what's needed instead.
 */
export function loadFixture(fixtureDir: string): LoadedFixture {
  const result = validateFixture(fixtureDir);
  if (!result.ok || !result.manifest) {
    const detail = result.errors.map((error) => `${error.path}: ${error.message}`).join("; ");
    throw new Error(`Invalid fixture at ${fixtureDir}: ${detail}`);
  }

  const sourceRoot = path.join(fixtureDir, "fixture");
  const sourceFiles: Record<string, string> = {};
  for (const relativeFile of result.manifest.files) {
    sourceFiles[relativeFile] = readFileSync(path.join(sourceRoot, relativeFile), "utf8");
  }

  return { manifest: result.manifest, fixtureDir, sourceFiles };
}

/** Validates every fixture under `root` — collects every failure rather than stopping at the first. */
export function validateAllFixtures(root: string = BENCHMARK_ROOT): FixtureValidationResult[] {
  return discoverFixtureDirs(root).map((dir) => validateFixture(dir));
}
