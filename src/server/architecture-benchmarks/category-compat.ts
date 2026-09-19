/**
 * Benchmark-only category compatibility layer for the Architecture
 * Reviewer — independent of, and not shared with,
 * `code-benchmarks/category-compat.ts`, `security-benchmarks/category-compat.ts`,
 * or `database-benchmarks/category-compat.ts` (see
 * `tests/architecture-benchmarks/README.md`). Maps a legacy/plain
 * category string production might emit to a canonical
 * `domain.subcategory` benchmark category, exactly the same design as
 * the other three benchmarks' own tables: explicit, hand-curated,
 * one-way, no fuzzy matching, generic bucket for a whole-domain-only
 * legacy string, direct mapping for one that's already specific.
 */
export const LEGACY_CATEGORY_MAP: Readonly<Record<string, string>> = {
  // layer boundaries / dependency direction
  layering: "layer-boundaries.generic",
  "layer-violation": "layer-boundaries.cross-layer-import",
  "layering-violation": "layer-boundaries.cross-layer-import",
  "cross-layer-import": "layer-boundaries.cross-layer-import",
  "dependency-direction": "layer-boundaries.cross-layer-import",
  "layer-boundaries": "layer-boundaries.generic",

  // responsibility separation / business logic leakage
  "responsibility-separation": "responsibility-separation.generic",
  "separation-of-concerns": "responsibility-separation.generic",
  "business-logic-leakage": "responsibility-separation.business-logic-leakage",
  "business-logic-in-ui": "responsibility-separation.business-logic-leakage",
  "misplaced-logic": "responsibility-separation.business-logic-leakage",

  // coupling
  coupling: "coupling.generic",
  "tight-coupling": "coupling.generic",
  "inappropriate-coupling": "coupling.bypasses-port-abstraction",
  "port-bypass": "coupling.bypasses-port-abstraction",

  // circular dependency
  "circular-dependency": "circular-dependency.generic",
  "circular-dependencies": "circular-dependency.generic",
  "circular-import": "circular-dependency.mutual-module-imports",
  "mutual-dependency": "circular-dependency.mutual-module-imports",

  // duplication
  duplication: "duplication.generic",
  "code-duplication": "duplication.generic",
  "duplicated-logic": "duplication.domain-logic-duplicated",
  "domain-duplication": "duplication.domain-logic-duplicated",

  // transaction orchestration
  "transaction-orchestration": "transaction-orchestration.generic",
  orchestration: "transaction-orchestration.generic",
  "misplaced-orchestration": "transaction-orchestration.misplaced-in-adapter",

  // provider/vendor leakage into domain
  "provider-leakage": "provider-leakage.generic",
  "vendor-lock-in": "provider-leakage.vendor-type-in-domain",
  "provider-coupling": "provider-leakage.vendor-type-in-domain",
  "sdk-leakage": "provider-leakage.vendor-type-in-domain",

  // scalability (only when concretely evidenced — see README)
  scalability: "scalability.generic",
  "scale-concern": "scalability.generic",
};

export function normalizeCategory(rawCategory: string): string | undefined {
  return LEGACY_CATEGORY_MAP[rawCategory];
}
