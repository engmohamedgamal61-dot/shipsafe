# layer-boundaries-01-repository-imports-ui-component

`SupabaseReviewRepository` (a persistence adapter under
`src/server/repositories/`) imports `RepositoryCard` from
`@/components/dashboard/repository-card` and calls it inline to build a
`displayCard` field on the data it returns. This codebase's real
`ports.ts`/`container.ts` convention is explicit: repositories/adapters
implement a port interface and know nothing about how their data is
rendered — UI components depend on domain types, never the reverse.

This is the clearest, most literal "cross-layer import" case in the
suite: one bad import line plus one call site, both in an 8-line method,
demonstrating exactly the dependency-direction inversion architecture
review exists to catch.
