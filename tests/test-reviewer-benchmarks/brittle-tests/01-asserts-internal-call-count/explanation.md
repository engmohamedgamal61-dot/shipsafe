# brittle-tests-01-asserts-internal-call-count

The test spies on `computeAutoMergeEligibility` and asserts only that it
was called once — never checking `finalizeReview`'s return value or any
observable side effect. This is the "tests that only verify
implementation details" and "brittle tests coupled to irrelevant
implementation details" archetypes in one: the test would fail on a
harmless internal refactor, and would still pass if the helper's result
were silently ignored, because it never checks what actually happens
with that result.
