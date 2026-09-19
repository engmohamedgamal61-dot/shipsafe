# safe-01-caching-decorator-follows-ports-pattern

`CachingReviewRepository` implements `ReviewRepository` and wraps
another instance of the same port, injected via its constructor — the
standard decorator pattern, and exactly how this codebase's own
`container.ts` composition root expects adapters to be assembled. It
adds a pure infrastructure concern (an in-process TTL cache) without
touching business rules, without importing anything from an unrelated
layer, and without instantiating a concrete dependency itself.

Zero findings expected. This is the direct structural counterpart to
`coupling-01` (a repository that DOES instantiate a concrete dependency
itself) — the difference (constructor injection vs. `new` inside the
class) is exactly what a reviewer needs to get right to avoid flagging
sound dependency-injection code as a violation.
