# Release Judge benchmark fixtures

Ground truth for `src/server/release-judge-benchmarks/`, which
establishes and (in a later pass) tunes a baseline for the production
Release Judge (`AnthropicJudgeProvider` in
`src/server/review-engine/providers/judge-provider.ts`).

## Why this benchmark looks different from the five specialist reviewers'

The five specialist reviewer benchmarks (`code-benchmarks/`,
`security-benchmarks/`, `database-benchmarks/`, `architecture-benchmarks/`,
`test-reviewer-benchmarks/`) grade an LLM's own freeform list of many
findings against many possible ground-truth findings, matched by
category/location. The Release Judge's production output
(`judgeOutputSchema`) is a single categorical `verdict` plus one prose
`summary` — there is nothing to location-match. So this benchmark:

- has no `fixture/` source-code directory — a fixture IS its
  `expected.json`, containing SIMULATED specialist `ReviewerRun`s
  (never raw code or a diff; the judge never sees either),
- scores one verdict against one expected verdict per fixture, plus a
  handful of qualitative properties (blocking findings, duplicate root
  causes, low-confidence findings, required-reviewer coverage, and a
  short hallucination-probe vocabulary) rather than a finding-matching
  pipeline,
- reuses `@/domain/verdict`'s real `minimumVerdictFor`/
  `checkRequiredReviewers` directly instead of reimplementing them,
  since those are the fixed specification this task is required NOT to
  modify — copying them by hand would only risk the benchmark silently
  drifting from the real thing it exists to check the judge against.

## Fixture format

```
tests/release-judge-benchmarks/<domain>/<fixture-id>/expected.json
```

See `src/server/release-judge-benchmarks/schema.ts` for the full
zod contract. Each fixture declares:

- `reviewer_runs`: one simulated `ReviewerRun` per specialist reviewer
  (or fewer, for the `failed-reviewer` fixture), each with its own
  `findings[]`.
- `expected.verdict`: the verdict a well-tuned judge should produce —
  may be stricter than the deterministic floor, never more lenient.
- `expected.blocking_finding_ids` / `duplicate_groups` /
  `low_confidence_only_finding_ids`: qualitative ground truth used by
  `scorer.ts`'s duplicate-inflation and over-escalation checks.
- `expected.requires_full_reviewer_coverage`: whether every required
  reviewer completed — schema-enforced to agree with `reviewer_runs`'
  actual statuses, and with `expected.verdict` (`DO_NOT_APPROVE` is
  required when coverage is incomplete).
- `expected.hallucination_probe_terms`: vocabulary NOT grounded in any
  of this fixture's own findings — the judge's `summary` should never
  contain it.

## The 10 fixtures

| Domain | Fixture | Tests | Expected verdict |
|---|---|---|---|
| `clean` | `01-clean-release` | Baseline: approve cleanly with zero findings | `APPROVE` |
| `minor-only` | `01-nit-and-p2-only` | Don't escalate cosmetic/maintainability-only findings | `APPROVE_WITH_MINOR_FIXES` |
| `confirmed-blocker` | `01-single-p1-security-finding` | A severe, confirmed security P1 should block on its own (judge policy, stricter than the bare floor) | `DO_NOT_APPROVE` |
| `confirmed-blocker` | `02-single-p0-finding` | Floor-guaranteed blocker; judge must not talk itself into APPROVE | `DO_NOT_APPROVE` |
| `aggregate-risk` | `01-multiple-p2-across-reviewers` | Volume of unrelated minor findings isn't itself an escalating signal | `APPROVE_WITH_MINOR_FIXES` |
| `conflicting-signals` | `01-single-p1-among-clean-reviewers` | Four clean reviewers must not dilute/average away one real P1 | `APPROVE_WITH_MINOR_FIXES` |
| `ambiguous` | `01-low-confidence-p1-finding` | A self-hedged, low-confidence finding must not be treated as confirmed | `APPROVE_WITH_MINOR_FIXES` |
| `duplicate` | `01-same-root-cause-two-reviewers` | Two reviewers describing the same root cause must not be double-counted | `APPROVE_WITH_MINOR_FIXES` |
| `failed-reviewer` | `01-required-reviewer-failed` | Fail-closed when required-reviewer coverage is incomplete (orchestration-level, not judge-level) | `DO_NOT_APPROVE` |
| `mixed-severity` | `01-realistic-release` | A realistic P1+P2+Nit mix with an explicit, floor-backed expected verdict | `APPROVE_WITH_MINOR_FIXES` |

## Running the live baseline

```
RUN_LIVE_RELEASE_JUDGE_BASELINE=1 node --env-file=.env.local node_modules/.bin/vitest run src/server/release-judge-benchmarks/baseline/run.live.test.ts
```

Writes `artifacts/release-judge-benchmark/current-baseline.json` and
`docs/agents/release-judge-baseline-current.md`.
