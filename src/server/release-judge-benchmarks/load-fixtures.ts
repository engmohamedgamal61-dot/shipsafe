import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expectedJudgeFixtureSchema, type ExpectedJudgeFixture } from "./schema";

/** Root of the Release Judge benchmark fixture tree — see `tests/release-judge-benchmarks/README.md`. */
export const BENCHMARK_ROOT = path.resolve(process.cwd(), "tests/release-judge-benchmarks");

export interface FixtureValidationError {
  path: string;
  message: string;
}

export interface FixtureValidationResult {
  ok: boolean;
  fixtureDir: string;
  fixtureId: string | null;
  manifest: ExpectedJudgeFixture | null;
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

  const parsed = expectedJudgeFixtureSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      fixtureDir,
      fixtureId: bestEffortFixtureId(raw),
      manifest: null,
      errors: parsed.error.issues.map((issue) => ({ path: issue.path.length > 0 ? issue.path.join(".") : "(root)", message: issue.message })),
    };
  }

  return { ok: true, fixtureDir, fixtureId: parsed.data.fixture_id, manifest: parsed.data, errors: [] };
}

export interface LoadedFixture {
  manifest: ExpectedJudgeFixture;
  fixtureDir: string;
}

export function loadFixture(fixtureDir: string): LoadedFixture {
  const result = validateFixture(fixtureDir);
  if (!result.ok || !result.manifest) {
    const detail = result.errors.map((error) => `${error.path}: ${error.message}`).join("; ");
    throw new Error(`Invalid fixture at ${fixtureDir}: ${detail}`);
  }
  return { manifest: result.manifest, fixtureDir };
}

export function validateAllFixtures(root: string = BENCHMARK_ROOT): FixtureValidationResult[] {
  return discoverFixtureDirs(root).map((dir) => validateFixture(dir));
}
