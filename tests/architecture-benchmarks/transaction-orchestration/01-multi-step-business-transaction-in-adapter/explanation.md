# transaction-orchestration-01-multi-step-business-transaction-in-adapter

`completeReviewWithFindings` lives on the persistence adapter but does
far more than persist: it sequences three separate writes AND computes
the verdict policy itself. This codebase's real `ReviewRepository` port
is deliberately read-only — the comment in the real
`supabase-adapter.ts` says so explicitly — because orchestrating a
multi-step business transaction and applying verdict rules is the
domain/orchestrator layer's job (`ReviewOrchestrator`,
`src/domain/verdict.ts`), not the adapter's.

Distinct from `responsibility-separation-01` (business logic in a
controller): here the SAME class of defect (business rules where they
don't belong) appears in the persistence layer instead, which is why
that category is accepted as an alternate framing.
