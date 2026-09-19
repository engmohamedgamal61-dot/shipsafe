# Test Reviewer benchmark

A 10-fixture benchmark suite for `src/server/review-engine/agents/test-reviewer.ts`,
built with the same disciplined methodology as `tests/code-benchmarks/`,
`tests/security-benchmarks/`, `tests/database-benchmarks/`, and
`tests/architecture-benchmarks/`, and kept **fully independent** of all
four: independent schema/scorer/adapter/category-compat/confidence-mapping
under `src/server/test-reviewer-benchmarks/`, independent fixture tree
here, independent baseline artifacts
(`docs/agents/test-reviewer-baseline-current.md`,
`artifacts/test-reviewer-benchmark/current-baseline.json`).

Named `test-reviewer-benchmarks` (not `test-benchmarks`) to avoid any
ambiguity with "benchmarks for tests" — this benchmark evaluates the
**Test Reviewer** specialist agent, not the test suite itself.

## Why a fifth, separate benchmark instead of sharing one

Same reasoning as the other four benchmarks' READMEs: the Test
Reviewer's categories (`missing-tests.*`, `weak-assertions.*`,
`brittle-tests.*`, `async-mistakes.*`, `mock-fidelity.*`,
`missing-error-path.*`, `duplicated-tests.*`) are a different taxonomy
from the Code, Security, Database, and Architecture reviewers', and a
shared scorer would either force an artificial mapping between
unrelated domains or grow an ever-larger union of special cases. Each
benchmark owns its own copy of the (structurally identical, but
independently maintained) scoring architecture instead.

## Fixture layout

```
<domain>/<NN>-<slug>/
  expected.json    — ground truth (required/optional findings, severity
                      range, confidence range, canonical category,
                      alternate categories, allowed/prohibited categories)
  explanation.md    — human-readable rationale: why the defect is real,
                      why a "safe" fixture is safe, or what's genuinely
                      unconfirmable in an ambiguous fixture
  fixture/*.ts      — the actual test file(s), and sometimes the
                      production file(s) they exercise
```

`fixture/**` is excluded from `tsconfig.json` and `eslint.config.mjs` —
these are minimal, illustrative snippets (some import a sibling module
that isn't real in the fixture set, since only the shown test's own
structure is under test), never compiled, linted, or executed as part
of the app's real test suite.

## The 10 fixtures (7 buggy : 2 safe : 1 ambiguous — same ratio as the other four benchmarks)

| Fixture | Archetype(s) covered | Ground truth |
|---|---|---|
| `missing-tests/01-critical-behavior-added-without-tests` | missing tests for critical behavior | a business-critical auto-merge policy function added with zero tests |
| `weak-assertions/01-tautological-assertion-proves-nothing` | weak assertions; always-passes tests | `expect(result).toBeDefined()` on a function that always returns a boolean |
| `brittle-tests/01-asserts-internal-call-count` | implementation-detail tests; brittle coupling | a test spies on an internal helper's call count instead of checking output |
| `async-mistakes/01-missing-await-on-rejection-assertion` | async tests missing await | `expect(...).rejects.toThrow()` never awaited |
| `mock-fidelity/01-mock-hides-real-integration-contract` | mocked behavior hiding the real contract | a Supabase mock hand-crafted to match the code's own expectations |
| `missing-error-path/01-only-happy-path-tested` | missing negative/error-path and boundary coverage | only a multi-element happy-path test exists; empty-array throw path untested |
| `duplicated-tests/01-three-tests-assert-the-same-thing` | duplicated/redundant tests | three tests exercising the identical code path with different literals |
| `safe/01-comprehensive-test-suite` (safe) | safe, high-quality test suite | happy path + boundary + error path + edge case, all real assertions |
| `safe/02-legitimate-clock-mock` (safe) | false-positive trap for "any mock is bad" | `vi.setSystemTime` controls only the non-deterministic clock input |
| `ambiguous/01-message-text-changed-tests-not-shown` (ambiguous) | test adequacy unconfirmable from the diff alone | a message-wording change with no test file shown |

## Scoring

Same classification model as `code-benchmarks/scorer.ts`
(`matched_required` / `matched_optional` / `duplicate` / `prohibited` /
`unsupported_extra` / `hallucinated_path` / `fabricated_evidence`),
including the FIXED, proven fabrication-detection logic (case-insensitive
verbatim matching, illustrative-example exemption, verified dotted/bare
method-reference exemption) — never weakened relative to the other four
benchmarks. Metrics: precision, recall, P0/P1 recall, safe-code
false-positive rate, ambiguous-overclaim rate, duplicate rate,
fabricated-evidence rate, hallucinated-path rate, severity accuracy,
category accuracy.

## Running the live baseline

```
RUN_LIVE_TEST_REVIEWER_BASELINE=1 node --env-file=.env.local node_modules/.bin/vitest run src/server/test-reviewer-benchmarks/baseline/run.live.test.ts
```

Never runs as part of `npm test` — costs real money and hits a real
external API. Invokes the current, unmodified production
`TestReviewerAgent` + `AnthropicProvider` directly (never the full
`ReviewOrchestrator`, to avoid paying for the other four specialist
reviewers' output this benchmark doesn't grade).
