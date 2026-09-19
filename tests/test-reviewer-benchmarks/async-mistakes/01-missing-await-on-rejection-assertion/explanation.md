# async-mistakes-01-missing-await-on-rejection-assertion

`expect(ingestPullRequest(null)).rejects.toThrow()` returns a Promise
that vitest must await to actually evaluate the assertion. The `it`
callback here is a plain synchronous function with no `await` and no
`return` on that expression, so the promise is fire-and-forgotten: the
test completes and reports "passed" before the assertion has actually
run, regardless of whether `ingestPullRequest` throws, resolves, or
never settles at all.

This is deliberately the single most common real-world instance of
"async tests missing await" — a pattern that silently converts an
error-path test into a no-op that always reports success.
