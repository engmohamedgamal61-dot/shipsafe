/**
 * Explicit, hand-bumped version identifiers for the Architecture
 * Reviewer benchmark — independent of the other three benchmarks'
 * `versions.ts` (see `tests/architecture-benchmarks/README.md`). Same
 * policy: plain strings, bumped by hand, never derived from a
 * timestamp or git SHA.
 */

/**
 * The shape of `expected.json` (`schema.ts`) and the scorer's
 * classification/matching semantics (`scorer.ts`). Semver — bump patch
 * for a wording/doc-only change, minor for an additive/widening scorer
 * change, major for anything that could change an existing fixture's
 * verdict in the stricter direction.
 */
export const ARCHITECTURE_BENCHMARK_SCHEMA_VERSION = "1.0.0";

/** Which fixtures exist and in what state — hand-bumped, never a git SHA. */
export const ARCHITECTURE_BENCHMARK_DATASET_VERSION = "phase1-10-of-10";

/**
 * Placeholder, explicitly labeled as such — `architecture-reviewer.ts`
 * has no versioned instructions string today.
 */
export const ARCHITECTURE_REVIEWER_PROMPT_VERSION = "untracked-first-baseline-pass";
