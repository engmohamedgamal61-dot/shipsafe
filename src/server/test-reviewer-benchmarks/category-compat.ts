/**
 * Benchmark-only category compatibility layer for the Test Reviewer —
 * independent of, and not shared with, the other four benchmarks'
 * `category-compat.ts` (see `tests/test-reviewer-benchmarks/README.md`).
 * Maps a legacy/plain category string production might emit to a
 * canonical `domain.subcategory` benchmark category, exactly the same
 * design as the other four benchmarks' own tables: explicit,
 * hand-curated, one-way, no fuzzy matching, generic bucket for a
 * whole-domain-only legacy string, direct mapping for one that's
 * already specific.
 */
export const LEGACY_CATEGORY_MAP: Readonly<Record<string, string>> = {
  // missing tests
  "missing-tests": "missing-tests.generic",
  "missing-test-coverage": "missing-tests.critical-behavior",
  "no-tests": "missing-tests.critical-behavior",
  "test-coverage": "missing-tests.generic",

  // weak assertions
  "weak-assertion": "weak-assertions.generic",
  "weak-assertions": "weak-assertions.generic",
  tautological: "weak-assertions.tautological",
  "trivial-assertion": "weak-assertions.tautological",

  // implementation-detail / brittle coupling
  "implementation-detail": "brittle-tests.generic",
  "brittle-test": "brittle-tests.generic",
  "brittle-tests": "brittle-tests.generic",
  "implementation-coupling": "brittle-tests.implementation-coupling",

  // async mistakes
  "async-bug": "async-mistakes.generic",
  "async-mistake": "async-mistakes.generic",
  "missing-await": "async-mistakes.missing-await",

  // mock fidelity
  "mock-fidelity": "mock-fidelity.generic",
  mocking: "mock-fidelity.generic",
  "over-mocking": "mock-fidelity.hides-real-contract",
  "mock-contract": "mock-fidelity.hides-real-contract",

  // missing error-path / boundary coverage
  "missing-error-handling-test": "missing-error-path.generic",
  "error-path": "missing-error-path.generic",
  "missing-edge-case": "missing-error-path.untested-failure-mode",
  "boundary-coverage": "missing-error-path.untested-failure-mode",

  // duplicated tests
  "duplicate-tests": "duplicated-tests.generic",
  "redundant-tests": "duplicated-tests.redundant-coverage",
  "test-duplication": "duplicated-tests.redundant-coverage",
};

export function normalizeCategory(rawCategory: string): string | undefined {
  return LEGACY_CATEGORY_MAP[rawCategory];
}
