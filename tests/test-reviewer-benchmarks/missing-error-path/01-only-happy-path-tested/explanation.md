# missing-error-path-01-only-happy-path-tested

`totalReviewScore`'s only test covers a three-element array. The
function itself throws on an empty array (`reduce` with no initial
value) — a realistic input (a PR with zero reviews) that has zero test
coverage. This is the "missing negative/error-path coverage" and
"missing boundary/edge-case coverage" archetypes together: the happy
path is tested, but the one input most likely to break in production
never is.

Deliberately shares its production function with
`tests/code-benchmarks/edge-case-api-misuse/01-reduce-no-initial-value`
to test reviewer LANE discipline: the reduce bug itself is a Code
Reviewer finding, not a Test Reviewer one — the correct Test Reviewer
finding is about the test file's incomplete coverage, not the
production function's own correctness.
