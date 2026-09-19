# duplicated-tests-01-three-tests-assert-the-same-thing

Three tests, three different literal numbers, one code path: every test
sums a two-element array. None explores a different array shape (one
element, empty, many elements) or a different value class (negative
numbers). This is "duplicated/redundant tests that add no real
confidence" in its clearest form — more test COUNT, not more test
COVERAGE.

Ground truth spans all three tests as one finding, testing whether the
reviewer correctly treats "a group of near-identical tests" as a single
root cause rather than three separate complaints.
