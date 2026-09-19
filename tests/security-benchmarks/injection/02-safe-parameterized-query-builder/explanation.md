# injection-02-safe-parameterized-query-builder

**What this tests:** whether the reviewer can tell a real SQL-injection
sink (`pool.query(rawString)`, fixture `injection-01`) apart from a
superficially similar-looking but actually-parameterized call
(`.ilike()`), rather than pattern-matching on "template literal near a
query-sounding function name."

**Why it's shaped this way:** deliberately mirrors `injection-01`'s
structure (same function name, same template-literal-wrapping-a-param
shape) so the two fixtures form a matched pair — a reviewer should score
1/1 on `injection-01` and 0/0 on this one, and a reviewer that can't tell
them apart will get exactly one of the two wrong.

**What would make this fixture wrong:** if `.ilike()` were replaced with
a raw `.query()`/`.rpc()` call taking a hand-built string, or if
`fullNameQuery` were later interpolated into a *second*, raw query
elsewhere in the same function (it isn't).
