# safe-02-legitimate-clock-mock

`vi.setSystemTime` controls the one genuinely non-deterministic input to
`isReviewStale` (the current time) while leaving the function's own
comparison logic fully real and exercised on both sides of the
threshold. This is the direct structural counterpart to
`mock-fidelity-01`: there, the mock replaced the LOGIC under test
(hand-crafting the exact response shape); here, the mock only replaces
a non-deterministic INPUT, which is the standard, necessary way to test
time-based code deterministically. Zero findings expected.
