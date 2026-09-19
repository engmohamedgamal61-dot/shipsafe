# ambiguous-01-index-build-lock-risk-unknown-table-size

`create index if not exists reviews_verdict_idx on public.reviews
(verdict);` — a plain `CREATE INDEX` (no `CONCURRENTLY`) takes a lock
that blocks writes to the target table for the duration of the build.
Whether that matters depends entirely on `public.reviews`'s current row
count and write-traffic volume in production, neither of which this
one-line migration can show.

This is the "migration safety" archetype's genuinely ambiguous twin to
`migration-safety-01` (which is unambiguous and unsafe regardless of
table size). The correct reviewer behavior is the same three-way
acceptance used throughout this benchmark suite's ambiguous fixtures:
omit, ask for more context, or a single low-confidence suggestion —
never a confident, high-severity assertion that this specific migration
will cause an outage.
