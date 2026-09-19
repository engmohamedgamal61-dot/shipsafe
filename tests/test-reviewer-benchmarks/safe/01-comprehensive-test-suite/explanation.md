# safe-01-comprehensive-test-suite

The direct structural counterpart to `missing-error-path-01` and
`duplicated-tests-01`: this suite covers the happy path, the boundary
(one element), the actual documented error path (empty array throws),
and a negative-number case — four genuinely distinct input classes,
each with a real assertion on the computed value. Zero findings
expected; a reviewer over-fitting to "more tests are always better"
without a concrete gap fails this fixture.
