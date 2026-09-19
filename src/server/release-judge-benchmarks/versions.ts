/**
 * Explicit, hand-bumped version identifiers for the Release Judge
 * benchmark — independent of the five specialist reviewers'
 * `versions.ts` files (see `tests/release-judge-benchmarks/README.md`).
 * Same policy: plain strings, bumped by hand, never derived from a
 * timestamp or git SHA.
 */

/**
 * The shape of `expected.json` (`schema.ts`) and the scorer's
 * classification semantics (`scorer.ts`).
 *
 * **Bumped to `1.1.0`**, then further widened within the same Phase 4
 * root-cause analysis, across two live-run fix cycles on the first two
 * real baseline runs. `detectGroundingIssues`'s `false_no_issues_claim`
 * check fired on a per-reviewer "no issues" breakdown that also
 * correctly described the one reviewer that DID find something (a
 * scorer false positive, not a judge defect); its
 * `unwarranted_critical_claim` check fired on ordinary English use of
 * "critical" to describe a severe P1, not a literal P0 mislabeling; and
 * `false_no_issues_claim` fired a second time on a summary that
 * accurately described a finding's actual substance without ever
 * repeating its numeric severity label, which the first fix's
 * severity-vocabulary check alone couldn't see. All three were
 * narrowed/widened to require the summary have no OTHER grounding —
 * severity vocabulary OR the finding's own specific title words — for
 * the language in question, rather than pattern-matching one phrase in
 * isolation. Purely a benchmark-scorer precision fix — no change ever
 * made to the judge, provider, orchestrator, or verdict floor — so
 * `minor`, not `major`.
 *
 * **Bumped to `1.2.0`** after the first post-tuning live run exposed
 * two further methodology issues, again purely on the benchmark side:
 * (1) `failed-reviewer-01` (a deliberate raw-judge-only adversarial
 * probe — production's `checkRequiredReviewers` blocks before the
 * judge is ever consulted for real) was counting against
 * production-facing `verdictAccuracy`/`blockingDefectRecall`/
 * `missedBlockerRate`; those three now exclude any fixture where
 * `countsTowardProductionFacingMetrics` is false, and the old
 * `failedReviewerHandlingAccuracy` field was renamed
 * `rawJudgeFailedReviewerHandlingRate` to make its informational,
 * non-production-facing status explicit rather than implicit; (2) the
 * tuned judge's new grounding instruction made it state severity levels
 * explicitly far more often (e.g. "no P0/P1 or security issues found"),
 * and both `detectGroundingIssues`'s `unwarranted_critical_claim` check
 * and the hallucination-probe-term check matched the bare term with no
 * regard for a preceding negation, flagging accurate denials as
 * fabrications. Fixed with `hasUngroundedPositiveMention`, which only
 * counts a term as asserted when at least one of its occurrences has no
 * negation marker in the preceding ~40 characters. Additive/narrowing
 * (removes false positives, never weakens genuine-fabrication
 * detection — a truly invented positive claim like "there is a P0
 * finding" still matches), so `minor`, not `major`.
 */
export const RELEASE_JUDGE_BENCHMARK_SCHEMA_VERSION = "1.2.0";

/** Which fixtures exist and in what state — hand-bumped, never a git SHA. */
export const RELEASE_JUDGE_BENCHMARK_DATASET_VERSION = "phase1-10-of-10";

/**
 * Bumped from the initial baseline pass: `buildJudgeSystemPrompt`
 * (`prompt.ts`) gained 5 numbered instructions, and `ReleaseJudgeAgent`
 * (`agents/release-judge.ts`) gained `enforceMinimumVerdictForAnyFinding`
 * normalization — the tuning pass that fixed the one confirmed
 * raw-judge calibration defect from the first baseline (see
 * `docs/agents/release-judge-baseline-current.md`).
 */
export const RELEASE_JUDGE_PROMPT_VERSION = "tuning-pass-1-minimum-verdict-floor";
