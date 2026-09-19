# maintainability-01-deep-nesting-duplication

`classifyOrder()` is exhaustively correct — every one of the sixteen
`(isPriority, country, total-bucket)` combinations returns the right
label. The defect is structural, not functional: the same
`total > 1000` check is repeated four times under four different nested
branches, and a future change to the threshold or label scheme would
need to be applied consistently in four places by hand.

Ground truth requires a finding here, but pins its severity to
`[Nit, P2]` specifically to test severity CALIBRATION, not just
detection: a reviewer that flags this as `P0`/`P1` is treating a
maintainability concern as if it were a live defect, which is exactly
the kind of over-escalation `refactor-trap-01` (in this same benchmark)
also probes from a different angle.
