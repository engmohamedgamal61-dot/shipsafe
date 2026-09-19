# weak-assertions-01-tautological-assertion-proves-nothing

The test calls the real function under test but only asserts
`expect(result).toBeDefined()`. Since `computeAutoMergeEligibility`
always returns a boolean (never `undefined`), this assertion is
tautologically true regardless of the function's actual logic — it
would still pass if the function always returned `true`, always
returned `false`, or had its conditional branches swapped entirely.

This is the "always passes / false-positive test" archetype in its
purest form: a real function call wrapped in an assertion that cannot,
by construction, ever fail.
