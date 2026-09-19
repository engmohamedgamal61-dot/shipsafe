/**
 * Explicit, hand-bumped version identifiers for the Database Reviewer
 * benchmark — independent of `code-benchmarks/versions.ts` and
 * `security-benchmarks/versions.ts` (see
 * `tests/database-benchmarks/README.md`). Same policy: plain strings,
 * bumped by hand, never derived from a timestamp or git SHA.
 */

/**
 * The shape of `expected.json` (`schema.ts`) and the scorer's
 * classification/matching semantics (`scorer.ts`). Semver — bump patch
 * for a wording/doc-only change, minor for an additive/widening scorer
 * change (a new exemption that never rejects something previously
 * accepted), major for anything that could change an existing fixture's
 * verdict in the stricter direction.
 */
export const DATABASE_BENCHMARK_SCHEMA_VERSION = "1.0.0";

/** Which fixtures exist and in what state — hand-bumped, never a git SHA. */
export const DATABASE_BENCHMARK_DATASET_VERSION = "phase1-10-of-10";

/**
 * Placeholder, explicitly labeled as such — `database-reviewer.ts` has
 * no versioned instructions string today. See
 * `code-benchmarks/versions.ts`'s `CODE_REVIEWER_PROMPT_VERSION` for the
 * same gap on that benchmark; this is the Database Reviewer's equivalent
 * stand-in.
 */
export const DATABASE_REVIEWER_PROMPT_VERSION = "untracked-first-baseline-pass";
