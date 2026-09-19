/**
 * Benchmark-only category compatibility layer for the Database
 * Reviewer — independent of, and not shared with,
 * `code-benchmarks/category-compat.ts` or
 * `security-benchmarks/category-compat.ts` (see
 * `tests/database-benchmarks/README.md`). Maps a legacy/plain category
 * string production might emit to a canonical `domain.subcategory`
 * benchmark category, exactly the same design as the other two
 * benchmarks' own tables: explicit, hand-curated, one-way, no fuzzy
 * matching, generic bucket for a whole-domain-only legacy string, direct
 * mapping for one that's already specific.
 */
export const LEGACY_CATEGORY_MAP: Readonly<Record<string, string>> = {
  // foreign keys / referential integrity
  "foreign-key": "foreign-keys.generic",
  "foreign-keys": "foreign-keys.generic",
  "missing-foreign-key": "foreign-keys.missing-reference",
  "referential-integrity": "foreign-keys.generic",

  // nullability
  nullability: "nullability.generic",
  "nullable-column": "nullability.missing-not-null",
  "missing-not-null": "nullability.missing-not-null",

  // data integrity (umbrella, when a finding doesn't name a more specific sub-check)
  "data-integrity": "data-integrity.generic",

  // cascade / delete behavior
  cascade: "cascade-delete.generic",
  "cascade-delete": "cascade-delete.generic",
  "unsafe-cascade": "cascade-delete.unsafe-cascade",
  "delete-behavior": "cascade-delete.generic",

  // race conditions / uniqueness
  "race-condition": "race-condition.generic",
  uniqueness: "race-condition.generic",
  "missing-unique-constraint": "race-condition.missing-unique-constraint",
  "unique-constraint": "race-condition.missing-unique-constraint",

  // migration safety
  migration: "migration-safety.generic",
  "migration-safety": "migration-safety.generic",
  "database-migration": "migration-safety.generic",
  "database-migration-safety": "migration-safety.generic",
  "unsafe-migration": "migration-safety.unsafe-not-null-addition",
  "schema-migration": "migration-safety.generic",
  locking: "migration-safety.generic",

  // performance / indexing / N+1
  performance: "performance.generic",
  "n-plus-one": "performance.n-plus-one",
  "query-performance": "performance.generic",
  indexing: "performance.generic",
  "database-indexing": "performance.generic",
  "missing-index": "performance.generic",

  // transaction boundaries
  transaction: "transaction-boundary.generic",
  "transaction-boundary": "transaction-boundary.generic",
  atomicity: "transaction-boundary.non-atomic-multi-step-write",

  // schema / data type
  "data-type": "schema-type.generic",
  "type-mismatch": "schema-type.generic",

  // tenant isolation AT the database layer (not general auth/RLS-policy review — see README)
  "tenant-isolation": "tenant-isolation.generic",
  rls: "tenant-isolation.generic",
  "row-level-security": "tenant-isolation.generic",
};

export function normalizeCategory(rawCategory: string): string | undefined {
  return LEGACY_CATEGORY_MAP[rawCategory];
}
