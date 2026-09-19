# access-control-01-idor-service-role-no-owner-check

**What this tests:** the most basic access-control miss — a route that
reads a resource by client-supplied id using a client that bypasses RLS
(`createServiceSupabaseClient`), with genuinely no ownership/session
check anywhere in the function. This mirrors
`docs/agents/security-reviewer-v2.md` §9's "Example A" worked example —
a reviewer that can't find this one shouldn't be trusted with anything
subtler.

**Why it's shaped this way:** deliberately a single, short function with
nothing else going on, so a failure to flag it can't be explained away
as "the real check must be somewhere else in a longer file."

**What would make this fixture wrong:** if `params.id` were validated
against the caller's session/workspace anywhere before the query, or if
the client used were the user-session client (RLS-scoped) instead of the
service-role one.
