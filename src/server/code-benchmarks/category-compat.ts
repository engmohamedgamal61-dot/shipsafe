/**
 * Benchmark-only category compatibility layer for the Code Reviewer —
 * independent of, and not shared with, `security-benchmarks/category-compat.ts`
 * (see `tests/code-benchmarks/README.md` for why). Maps a legacy/plain
 * category string production might emit to a canonical
 * `domain.subcategory` benchmark category, exactly the same design as
 * the security benchmark's own table: explicit, hand-curated, one-way,
 * no fuzzy matching, generic bucket for a whole-domain-only legacy
 * string, direct mapping for one that's already specific.
 */
export const LEGACY_CATEGORY_MAP: Readonly<Record<string, string>> = {
  // correctness
  correctness: "correctness.generic",
  bug: "correctness.generic",
  "logic-error": "correctness.generic",
  "off-by-one": "correctness.off-by-one",

  // maintainability
  maintainability: "maintainability.generic",
  "code-smell": "maintainability.generic",
  complexity: "maintainability.complexity",
  duplication: "maintainability.duplication",
  "code-duplication": "maintainability.duplication",

  // performance
  performance: "performance.generic",
  "algorithmic-complexity": "performance.algorithmic-complexity",
  "n-plus-one": "performance.algorithmic-complexity",

  // dead-code
  "dead-code": "dead-code.unreachable",
  "unreachable-code": "dead-code.unreachable",
  unreachable: "dead-code.unreachable",

  // error-handling
  "error-handling": "error-handling.swallowed-exception",
  "swallowed-error": "error-handling.swallowed-exception",
  "swallowed-exception": "error-handling.swallowed-exception",
  "empty-catch": "error-handling.swallowed-exception",

  // concurrency
  concurrency: "concurrency.generic",
  "race-condition": "concurrency.generic",
  "missing-await": "concurrency.missing-await",
  "async-bug": "concurrency.missing-await",

  // edge-case / api-misuse
  "edge-case": "edge-case.generic",
  "edge-case-handling": "edge-case.generic",
  "empty-input": "edge-case.empty-input",
  "api-misuse": "api-misuse.generic",
  "incorrect-api-usage": "api-misuse.generic",
};

export function normalizeCategory(rawCategory: string): string | undefined {
  return LEGACY_CATEGORY_MAP[rawCategory];
}
