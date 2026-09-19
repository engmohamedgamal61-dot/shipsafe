# performance-01-linear-scan-in-filter

`filterBlockedComments()` filters `comments` (length n) by checking
`blockedUserIds.includes(...)` (length m) for each one — `Array.prototype.includes`
is a linear scan, so calling it once per element of `comments` makes
the whole operation O(n * m). Swapping `blockedUserIds` for a `Set` and
calling `.has()` instead makes this O(n + m).

This fixture is deliberately "concrete evidence" rather than
speculative: the O(n*m) shape is provable purely from reading the two
nested iteration constructs (no assumption about how large either list
gets in production is needed to know the ALGORITHM itself is
quadratic-shaped). A reviewer that only flags performance issues when
it can point to an actual measured slowdown would incorrectly stay
silent here — the code's structure itself is the evidence.
