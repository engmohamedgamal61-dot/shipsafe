# multi-tenant-04-ambiguous-security-definer-no-callsite

**What this tests:** whether the reviewer can correctly say "I don't
have enough information to be confident" instead of either (a)
confidently asserting a P0 it can't actually back up, or (b) staying
silent on a real, worth-flagging gap (missing an internal check inside
a privilege-elevating function) just because it can't prove
exploitability from this file alone.

**Why it's shaped this way:** this is spec §9's own "Example B" —
copied deliberately, not just inspired by it — because it's the
canonical case of the taxonomy's confidence-vs-severity distinction:
the missing internal check is a real, visible fact in this file; the
"is it actually reachable by an untrusted caller" question is not
answerable from this file, and the correct move is to say so rather
than guess in either direction.

**Fixed — a real contradiction in the original manifest:** this
fixture originally listed its conditional observation under
`required_findings[]` while also declaring
`needs_more_context_acceptable: true`. Those two statements can't both
be true: a `required_findings[]` entry is, by definition, something
every correct run must produce, which directly contradicts "zero
findings is also a fully correct answer" for the very same fixture.
The fix (see the plan's §3.1): the observation now lives in
`optional_findings[]` instead, and `required_findings` is empty. The
three fully correct responses are now unambiguous: zero findings, an
explicit `needs_more_context` signal, or a single low-confidence
finding matching the `optional_findings[]` entry. The same fix was
applied to `webhooks-01`'s secondary idempotency observation, which had
the same underlying problem in a milder form (a widened
`finding_count.max` standing in for what should have been an
`optional_findings[]` entry, before that field existed).

**What would make this fixture wrong:** if a call site (an RPC grant,
a route, a trigger) invoking this function with a client-suppliable
`workspace_id` were included, this would become an unambiguous
`vulnerable` fixture instead — confidence would no longer need to be
capped.
