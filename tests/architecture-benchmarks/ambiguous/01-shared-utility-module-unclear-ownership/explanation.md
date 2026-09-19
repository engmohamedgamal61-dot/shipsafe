# ambiguous-01-shared-utility-module-unclear-ownership

`shared-utils.ts` defines two functions: `formatReviewSummary` (clearly
a harmless, generic formatting helper — no ambiguity there) and
`computeStalenessThresholdMs` (returns one day in milliseconds). The
second one is genuinely ambiguous: it could be an arbitrary, harmless
default value, or it could quietly encode a real business policy (when
a review is considered "stale") that belongs in the domain layer
instead of a grab-bag utils file.

This fixture deliberately gives no call sites and no other context, so
the diff alone cannot resolve which it is — exactly the "scalability/
architecture concerns only when concretely evidenced" and "ambiguous
cases where the reviewer should hedge or omit" archetypes requested for
this benchmark.
