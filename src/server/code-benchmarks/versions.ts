/**
 * Explicit, hand-bumped version identifiers for the Code Reviewer
 * benchmark — independent of `security-benchmarks/versions.ts` (see
 * `tests/code-benchmarks/README.md`). Same policy: plain strings,
 * bumped by hand, never derived from a timestamp or git SHA.
 */

/**
 * The shape of `expected.json` (`schema.ts`) and the scorer's
 * classification/matching semantics (`scorer.ts`). Semver — see
 * `security-benchmarks/versions.ts`'s identically-named constant for
 * the bump policy (patch/minor/major).
 *
 * **Bumped to `1.1.0`** during Phase 4 root-cause analysis of the
 * first real baseline run: `isVerifiableApiReference`'s dotted-API-
 * reference exemption was generalized to also recognize a leading-dot
 * and/or trailing-empty-parens method reference (`` `.filter()` ``),
 * confirmed necessary by that run's own output. Purely additive/widening
 * — every span that verified before still verifies — so `minor`, not
 * `major`, per this constant's own bump policy.
 */
export const CODE_BENCHMARK_SCHEMA_VERSION = "1.1.0";

/**
 * Which fixtures exist and in what state — hand-bumped, never a git
 * SHA. **Bumped to the `-r2` revision** during the same Phase 4 audit:
 * `correctness-02`'s `chunk()` gained a guard against a genuine
 * infinite-loop defect on non-positive/NaN `size` (a real bug in the
 * fixture's own "safe" code, confirmed by auditing the reviewer's
 * claim rather than assuming it was a false positive), and
 * `correctness-01` gained an `optional_findings` entry for a real,
 * independent secondary observation the same run surfaced.
 */
export const CODE_BENCHMARK_DATASET_VERSION = "phase1-10-of-10-r2";

/**
 * Placeholder, explicitly labeled as such — `code-reviewer.ts` has no
 * versioned instructions string today. See
 * `security-benchmarks/versions.ts`'s `REVIEWER_PROMPT_VERSION` for the
 * same gap on that benchmark; this is the Code Reviewer's equivalent
 * stand-in.
 */
export const CODE_REVIEWER_PROMPT_VERSION = "untracked-first-baseline-pass";
