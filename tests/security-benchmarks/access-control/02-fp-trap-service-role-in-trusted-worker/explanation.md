# access-control-02-fp-trap-service-role-in-trusted-worker

**What this tests:** whether the reviewer distinguishes "service-role
client used" (a pattern that superficially resembles fixture 01) from
"service-role client used to serve an unvalidated, attacker-influenced
request" — only the latter is actually a finding. Real ShipSafe code
(`src/server/github/worker-loop.ts`) uses exactly this shape.

**Why it's shaped this way:** deliberately reuses the same
`createServiceSupabaseClient()` call from fixture 01 so a reviewer that
only pattern-matches on "service role + no visible check" (rather than
tracing what actually triggers the call) fails both fixtures identically
— this one should score zero findings, fixture 01 should score exactly
one.

**What would make this fixture wrong:** if `claimNextPendingReview` were
shown to accept caller-supplied identifiers with no validation, or if
this function were reachable from an HTTP route rather than a fixed
internal poll loop.
