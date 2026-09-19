import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { expectedFixtureSchema, type ExpectedFixture } from "./schema";

/** Root of the Code Reviewer benchmark fixture tree — see `tests/code-benchmarks/README.md`. */
export const BENCHMARK_ROOT = path.resolve(process.cwd(), "tests/code-benchmarks");

export interface FixtureValidationError {
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

export function discoverFixtureDirs(root: string = BENCHMARK_ROOT): string[] {
  const found: string[] = [];

  function walk(dir: string): void {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith("_") || entry.name.startsWith(".")) continue;
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
      errors: [{ path: "expected.json", message: `not valid JSON: ${error instanceof Error ? error.message : String(error)}` }],
    };
  }

  const parsed = expectedFixtureSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      fixtureDir,
      fixtureId: bestEffortFixtureId(raw),
      manifest: null,
      errors: parsed.error.issues.map((issue) => ({ path: issue.path.length > 0 ? issue.path.join(".") : "(root)", message: issue.message })),
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
  sourceFiles: Record<string, string>;
}

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

export function validateAllFixtures(root: string = BENCHMARK_ROOT): FixtureValidationResult[] {
  return discoverFixtureDirs(root).map((dir) => validateFixture(dir));
}
