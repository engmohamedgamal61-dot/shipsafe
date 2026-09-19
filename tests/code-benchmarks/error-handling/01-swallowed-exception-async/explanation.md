# error-handling-01-swallowed-exception-async

The `catch (err) { console.log("reindex failed"); }` block never uses
`err` at all — the actual error message/stack is thrown away — and
never rethrows or signals failure through the return value. Since
`reindexSearchDocuments` returns `Promise<void>`, a caller has no way to
tell success from failure, and if this fails silently in production
there is no error detail logged anywhere to diagnose why.

This is a more realistic error-handling defect than a bare empty catch
block: it superficially looks like "the error is handled" (there's a
log line), which is exactly why it's a good test of whether the
reviewer checks WHAT the catch block does with the error, not just
whether a catch block exists.
