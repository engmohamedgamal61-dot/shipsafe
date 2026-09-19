# duplication-01-severity-order-duplicated-across-modules

`release-judge.ts` and `dashboard-summary.ts` both independently define
the identical `SEVERITY_ORDER` array. Severity ranking is a piece of
domain policy (compare this codebase's real, single-source-of-truth
`SEVERITY_RANK` constants used throughout the review-engine and
benchmark code) — duplicating it risks silent drift the moment one copy
is updated and the other isn't.

Unlike a hypothetical "this might get duplicated somewhere else later"
concern, both copies are shown side-by-side in this fixture's own diff —
concrete, current evidence. The expected answer is ONE finding
referencing both files as the same root cause, not two separate
per-file findings.
