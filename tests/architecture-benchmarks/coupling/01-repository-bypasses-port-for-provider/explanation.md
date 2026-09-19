# coupling-01-repository-bypasses-port-for-provider

`SupabaseReviewRepository` directly imports `AnthropicProvider` and
instantiates it as a field, then calls its `review()` method from inside
a data-listing method. This codebase's real `container.ts` is explicit
that it is "the ONLY place... that decides which adapter backs each
port" — every other module depends on port types, never a concrete
class from an unrelated layer.

Distinct from `layer-boundaries-01` (a repository depending on the UI
layer): this is a repository depending on the *review-engine/provider*
layer — a different pair of layers, same underlying "bypasses the
composition root" defect shape, which is why `layer-boundaries.cross-layer-import`
is accepted as an alternate category rather than treated as wrong.
