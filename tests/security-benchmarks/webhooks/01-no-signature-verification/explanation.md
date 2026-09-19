# webhooks-01-no-signature-verification

**What this tests:** the P0 webhook case — a handler that parses and
acts on (a real state-changing side effect: `markInvoicePaid`) a webhook
payload with zero signature verification anywhere in the function.

**Why it's shaped this way:** modeled on ShipSafe's own
`src/app/api/webhooks/github/route.ts`, but stripped down to a
different, simpler domain (billing) so the fixture doesn't require
familiarity with GitHub's specific webhook shape — the point being
tested (verify-before-act) is domain-independent.

**Fixed — this fixture is what originally exposed the scoring-model
ambiguity:** the handler also has no idempotency/replay protection, a
real, independent `webhooks`-category gap in the same few lines.
`expected.json` originally worked around this by widening
`finding_count.max` to `2` so a reviewer that raised both issues
wasn't penalized — but the plan's §4.1 matching algorithm had no
defined bucket for "a second, legitimately-different finding that
isn't required but also isn't wrong," so a reviewer that raised *only*
the idempotency finding (skipping the actual required one) would have
scored identically to one that raised both. Fixed by moving the
idempotency observation into `optional_findings[]` (`opt-1`): matching
it is never required and never penalized, but it no longer stands in
for, or gets confused with, the required signature-verification
finding (`req-1`).

**What would make this fixture wrong:** if a signature check preceded
the `payload.type` branch, or if the route were shown to run behind some
other, out-of-band authentication this fixture doesn't include.
