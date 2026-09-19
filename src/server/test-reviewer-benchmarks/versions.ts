/**
 * Explicit, hand-bumped version identifiers for the Test Reviewer
 * benchmark — independent of the other four benchmarks' `versions.ts`
 * (see `tests/test-reviewer-benchmarks/README.md`). Same policy: plain
 * strings, bumped by hand, never derived from a timestamp or git SHA.
 */

/**
 * The shape of `expected.json` (`schema.ts`) and the scorer's
 * classification/matching semantics (`scorer.ts`). Semver — bump patch
 * for a wording/doc-only change, minor for an additive/widening scorer
 * change, major for anything that could change an existing fixture's
 * verdict in the stricter direction.
 *
 * **Bumped to `1.1.0`** during Phase 4 root-cause analysis of the first
 * real baseline run, across two live samples. `hasFabricatedCodeClaim`
 * gained four exemptions, each confirmed necessary by that run's own
 * output: (1) a bare source-file-name mention (`` `score.ts` ``); (2) a
 * bare common JS/TS reserved word/literal (`` `true` ``, `` `await` ``);
 * (3) a multi-segment method-CHAIN reference where each segment may
 * carry its own empty call parens (`` `select().in()` ``), broadened
 * from only a single trailing call; (4) quote-style normalization
 * (`'` and `"` treated as equivalent) when comparing a quoted span
 * against source text, since a double-quoted source string described
 * with single quotes is not a misquote of its content. Purely
 * additive/widening — every span that verified before still verifies —
 * so `minor`, not `major`.
 */
export const TEST_REVIEWER_BENCHMARK_SCHEMA_VERSION = "1.1.0";

/** Which fixtures exist and in what state — hand-bumped, never a git SHA. */
export const TEST_REVIEWER_BENCHMARK_DATASET_VERSION = "phase1-10-of-10";

/**
 * Placeholder, explicitly labeled as such — `test-reviewer.ts` has no
 * versioned instructions string today.
 */
export const TEST_REVIEWER_PROMPT_VERSION = "untracked-first-baseline-pass";
