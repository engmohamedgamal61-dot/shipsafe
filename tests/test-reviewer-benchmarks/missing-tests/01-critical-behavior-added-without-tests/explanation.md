# missing-tests-01-critical-behavior-added-without-tests

`computeAutoMergeEligibility` decides whether a PR merges without human
review — a genuinely critical, security/business-relevant policy
function, added with zero accompanying tests. This is deliberately the
cleanest possible "missing tests for critical behavior" case: the
entire diff is the untested function itself, so there's no ambiguity
about whether coverage might exist elsewhere (contrast with
`ambiguous-01`, where that possibility is exactly the point).
