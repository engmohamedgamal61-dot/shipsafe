# injection-01-sql-string-concatenation

**What this tests:** the clearest possible SQL injection — a real
driver (`pg`), a raw string built via template-literal interpolation,
executed directly. Nothing about the source or the sink is hidden.

**Why it's shaped this way:** intentionally tiny (12 lines) with a
single function and a single query, so a miss here can't be attributed
to the reviewer losing track of a longer file.

**What would make this fixture wrong:** if `fullNameQuery` were shown to
be validated against a strict allow-list/enum before reaching the
string, or if the query were built with a parameterized placeholder
(`$1`) instead of interpolation.
