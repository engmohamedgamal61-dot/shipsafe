/**
 * Explicit, hand-bumped version identifiers for the benchmark itself —
 * see `docs/agents/security-benchmark-plan.md` §8 (Versioning) for the
 * full reproducibility contract these feed, and Task 3 of the
 * hardening pass that added this file.
 *
 * Every constant below is a plain string, bumped BY HAND when the
 * thing it identifies changes. None of them is ever derived from a
 * timestamp, a git SHA, or any other runtime state — that's a
 * deliberate constraint (a version that recomputes itself from "now"
 * can't tell two different points in time apart, which defeats the
 * entire point of a reproducibility identifier). Per-RUN reproducibility
 * data (which provider/model actually generated a given run's output,
 * when it ran) is a separate concept, captured in `run-metadata.ts`.
 */

/**
 * Mirrors `docs/agents/security-reviewer-v2.md`'s own `Taxonomy
 * version:` header line exactly — bump this in lockstep whenever that
 * header changes, never independently. Date-based (`YYYY.MM.DD`),
 * matching the spec's own scheme.
 */
export const SECURITY_TAXONOMY_VERSION = "2026.09.19";

/**
 * The shape of `expected.json` (`schema.ts`'s `expectedFixtureSchema`)
 * and the scorer's classification/matching semantics (`scorer.ts`).
 * Semver (`major.minor.patch`):
 * - **patch** — a docs/comment-only clarification, no behavior change.
 * - **minor** — an additive, backward-compatible change (a new optional
 *   field, a new classification bucket that only fires on input no
 *   prior fixture/reviewer-output could have produced).
 * - **major** — anything that could change an already-authored
 *   fixture's score for an already-recorded reviewer output.
 *
 * Started at `1.0.0` in the pass that added this constant. The plan's
 * §8 previously listed it as entirely untracked (a real, stated gap) —
 * `1.0.0` was this identifier's FIRST value, not a resumption of some
 * prior numbering scheme that never existed. That pass's own additions
 * (Task 1/2/5's `evidenceState`/`standards`/etc.) were captured
 * retroactively as part of `1.0.0`, not a `1.1.0` bump, since there was
 * no earlier tracked version for them to be additive relative to.
 *
 * **Bumped to `2.0.0`** by the confirmed-scorer-defect-fix pass that
 * follows the first real production baseline run: three fixes in
 * `scorer.ts`/`schema.ts` — case-insensitive + illustrative-example/
 * dotted-API-reference-aware fabrication detection
 * (`hasFabricatedCodeClaim`), and `alternate_categories` on ground-truth
 * entries — can each change an ALREADY-RECORDED reviewer output's score
 * (the exact `1.0.0`→`2.0.0` trigger this constant's own policy names).
 * Concretely: the first baseline run's `database-01`/`injection-01`
 * hard failures and `webhooks-01` miss do not reproduce under `2.0.0`
 * against the identical reviewer output — see
 * `docs/agents/security-baseline-current.md`'s before/after comparison.
 */
export const BENCHMARK_SCHEMA_VERSION = "2.0.0";

/**
 * Which fixtures exist and in what state, as a human-readable, hand-
 * bumped label — deliberately NOT the git commit hash. A commit SHA is
 * exactly the "derived from git state" this file's own module doc
 * forbids for these constants; per-run git-commit tracking belongs in
 * `run-metadata.ts` instead (a property of a specific RUN, not of the
 * benchmark's own checked-in design). Bump this string by hand whenever
 * a fixture is added, removed, or has its ground truth meaningfully
 * (score-affecting) changed.
 *
 * **Bumped to the `-r2` revision**: `webhooks-01`'s `req-1` gained an
 * `alternate_categories` entry (`auth.broken-authentication`) as part of
 * the same confirmed-scorer-defect-fix pass noted on
 * `BENCHMARK_SCHEMA_VERSION` above — a real, score-affecting ground-truth
 * change to one of the 10 fixtures, not just a schema/scorer change.
 */
export const BENCHMARK_DATASET_VERSION = "phase1-10-of-40-r2";

/**
 * Placeholder, explicitly labeled as such — `src/server/review-engine/`
 * has no versioned prompt today (plan §8's other stated gap). This
 * constant exists so every benchmark report still has SOME value in
 * this slot instead of a silently-missing field, but it is NOT a real
 * prompt version: it names the taxonomy/spec state instead, the
 * closest real, hand-bumped identifier that actually exists right now.
 * Replace this with an actual prompt-version constant read from
 * `providers/prompt.ts` the day that file gets one — do not keep
 * deriving it from the taxonomy version once a real one exists.
 */
export const REVIEWER_PROMPT_VERSION = `untracked-uses-taxonomy-${SECURITY_TAXONOMY_VERSION}`;
