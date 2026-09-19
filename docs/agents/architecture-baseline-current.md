# Architecture Reviewer — Current Production Compatibility Baseline

**This is a compatibility baseline of the CURRENT production Architecture Reviewer, measured as-shipped.**

This report measures `src/server/review-engine/agents/architecture-reviewer.ts` exactly as it exists today, against the 10 fixtures under `tests/architecture-benchmarks/`. No prompt, provider, or scoring change was made based on this run's results.

## Run metadata (reproducibility)

| Field | Value |
|---|---|
| Provider | `anthropic` |
| Model | `claude-sonnet-5` |
| Max tokens per reviewer | 4096 |
| Request timeout | 30000 ms |
| Concurrency | 1 (sequential) |
| Temperature | not set by `AnthropicProvider` (API default) |
| Thinking mode | not enabled by `AnthropicProvider` |
| Architecture benchmark schema version | `1.0.0` |
| Architecture benchmark dataset version | `phase1-10-of-10` |
| Architecture reviewer prompt version | `untracked-first-baseline-pass` |
| Run timestamp | 2026-09-19T16:29:46.047Z |

## Methodology

- Each fixture's full source file(s) are wrapped in a synthetic "new file" unified diff (every line a `+` addition, numbered from 1) — see `baseline/context.ts`.
- The unmodified production `ArchitectureReviewerAgent` + `AnthropicProvider` classes are invoked directly — this harness never re-implements reviewer logic.
- `ReviewOrchestrator`'s other four specialist reviewers and Release Judge are NOT invoked — only the Architecture Reviewer is graded.
- A one-retry policy mirroring `ReviewOrchestrator.withRetry` is reproduced locally.
- Fixtures ran sequentially (concurrency 1), each independently.

## Aggregate metrics

| Metric | Value |
|---|---|
| Fixtures run | 10 |
| Fixtures passed | 10 |
| Fixtures with a hard failure | 0 |
| Precision | 88.9% |
| Recall | 100.0% |
| P0 recall | 100.0% |
| P1 recall | 100.0% |
| Safe-code false-positive rate | 0.0% |
| Ambiguous-case overclaim rate | 0.0% |
| Hallucinated-path rate | 0.0% |
| Fabricated-evidence rate | 0.0% |
| Duplicate rate | 11.1% |
| Severity accuracy | 100.0% |
| Category accuracy | 100.0% |
| Confidence calibration | high 100.0% (n=5) · medium 100.0% (n=2) · low 100.0% (n=2) |
| Average latency | 8525 ms |
| Total token usage | 30518 in / 6688 out |

## Per-fixture results

| Fixture | Domain | Tags | Status | Pass | Score | Required missed | Failure reasons |
|---|---|---|---|---|---|---|---|
| `ambiguous-01-shared-utility-module-unclear-ownership` | ambiguous | ambiguous | scored | ✅ | 1.00 | — | — |
| `circular-dependency-01-mutual-imports-between-services` | circular-dependency | buggy, multi_file | scored | ✅ | 0.95 | — | duplicate root cause |
| `coupling-01-repository-bypasses-port-for-provider` | coupling | buggy | scored | ✅ | 1.00 | — | — |
| `duplication-01-severity-order-duplicated-across-modules` | duplication | buggy, multi_file | scored | ✅ | 1.00 | — | — |
| `layer-boundaries-01-repository-imports-ui-component` | layer-boundaries | buggy | scored | ✅ | 1.00 | — | — |
| `provider-leakage-01-domain-type-imports-vendor-sdk-type` | provider-leakage | buggy | scored | ✅ | 1.00 | — | — |
| `responsibility-separation-01-business-logic-in-server-action` | responsibility-separation | buggy | scored | ✅ | 1.00 | — | — |
| `safe-01-caching-decorator-follows-ports-pattern` | safe | safe, false_positive_trap | scored | ✅ | 1.00 | — | — |
| `safe-02-type-only-cross-layer-import-is-fine` | safe | safe, false_positive_trap | scored | ✅ | 1.00 | — | — |
| `transaction-orchestration-01-multi-step-business-transaction-in-adapter` | transaction-orchestration | buggy | scored | ✅ | 1.00 | — | — |

### `ambiguous-01-shared-utility-module-unclear-ownership`

Summary: The new shared-utils.ts file bundles two unrelated concerns—a presentation/formatting helper and a domain policy constant—into a single generically-named module with no clear ownership boundary, which is an architectural smell around responsibility placement rather than a functional bug.

Score: 1.00 (raw 1) · Passed: true · Hard failure: false
Latency: 11074 ms · Tokens: 2893 in / 897 out

| # | Category (raw → normalized) | Severity | Confidence | File:Line | Match method | Classification | Matched id |
|---|---|---|---|---|---|---|---|
| 0 | responsibility-separation.business-logic-leakage | P2 | low | shared-utils.ts:1-7 | canonical_category_location | matched_optional | opt-1 |

<details><summary>Raw evidence text per finding (verbatim, for auditing hallucination/fabrication classifications)</summary>

- **#0** (matched_optional): shared-utils.ts exports formatReviewSummary, a presentation-layer concern (rendering a verdict/finding-count into a display string), alongside computeStalenessThresholdMs, which encodes a domain/business policy value (how long data is considered fresh). Grouping them in a single flat, genre-less utility file gives the module no clear layer or owner: it's unclear whether this file belongs to the domain layer, an application service, or a UI helper library. This makes it likely that domain policy constants and presentation helpers will keep accreting into the same ungoverned module as the codebase grows, blurring layer boundaries between domain policy and presentation concerns.

</details>

### `circular-dependency-01-mutual-imports-between-services`

Summary: The diff introduces two new modules, `ingest.ts` (github ingest domain) and `seed.ts` (demo seed data), that import from each other, forming a mutual/circular module dependency. This couples an ingestion pathway to a demo/test-data seeding utility and vice versa, which is a structural boundary violation regardless of runtime behavior.

Score: 0.95 (raw 0.7) · Passed: true · Hard failure: false
Latency: 10685 ms · Tokens: 3051 in / 948 out

| # | Category (raw → normalized) | Severity | Confidence | File:Line | Match method | Classification | Matched id |
|---|---|---|---|---|---|---|---|
| 0 | circular-dependency.mutual-module-imports | P1 | high | ingest.ts:1 | canonical_category_location | matched_required | req-1 |
| 1 | responsibility-separation.business-logic-leakage | P2 | medium | seed.ts:1-9 | canonical_category_location | duplicate | req-1 |

<details><summary>Raw evidence text per finding (verbatim, for auditing hallucination/fabrication classifications)</summary>

- **#0** (matched_required): [unverified quote removed] imports `recordReviewCompletion` from `@/server/demo/seed`, and [unverified quote removed] imports `ingestPullRequest` from [unverified quote removed]. This creates a direct mutual/circular module dependency: ingest depends on seed, and seed depends on ingest. This couples a production ingestion pathway to demo/seed data utilities, and means neither module can be understood, tested, or evolved independently of the other. It also risks module-resolution/initialization-order issues typical of circular imports.
- **#1** (duplicate): [unverified quote removed]'s `resetDemoData` calls into `ingestPullRequest` from the github ingestion module, meaning demo/test seeding logic is directly orchestrating production domain functionality, while the production [unverified quote removed] module in turn depends back on the demo module to record completion. This is an improper responsibility placement: production ingestion should not know about or invoke demo seeding utilities, and demo seeding should not be a required dependency for core ingestion to compile/run.

</details>

### `coupling-01-repository-bypasses-port-for-provider`

Summary: The new SupabaseReviewRepository, an implementation of the ReviewRepository persistence port, directly imports and instantiates the concrete AnthropicProvider from the review-engine layer and invokes it inside a repository method unrelated to AI review functionality. This couples the data-access adapter to a specific LLM provider implementation and to review-engine internals, violating layer boundaries and bypassing any provider port/abstraction that would normally mediate such a dependency.

Score: 1.00 (raw 1) · Passed: true · Hard failure: false
Latency: 10588 ms · Tokens: 3018 in / 842 out

| # | Category (raw → normalized) | Severity | Confidence | File:Line | Match method | Classification | Matched id |
|---|---|---|---|---|---|---|---|
| 0 | coupling.bypasses-port-abstraction | P1 | low | supabase-adapter.ts:1-12 | canonical_category_location | matched_required | req-1 |

<details><summary>Raw evidence text per finding (verbatim, for auditing hallucination/fabrication classifications)</summary>

- **#0** (matched_required): SupabaseReviewRepository, which implements the ReviewRepository port for data persistence, imports and instantiates `AnthropicProvider` directly (`private readonly provider = new AnthropicProvider(process.env.ANTHROPIC_API_KEY ?? "");`) and calls [unverified quote removed] from within `listRepositoriesForUser`. This mixes two unrelated architectural concerns: repository/persistence logic and AI-provider orchestration. The repository layer should depend only on abstractions relevant to its own responsibility (data access), not reach across into the review-engine's concrete provider implementation. This creates a dependency-direction violation (persistence layer depending on a provider concretion instead of going through a port), and hard-codes vendor-specific behavior into a component whose interface (ReviewRepository) gives no indication it performs AI calls.

</details>

### `duplication-01-severity-order-duplicated-across-modules`

Summary: Two new modules independently define the same severity-ordering domain policy (SEVERITY_ORDER array) rather than sharing a single canonical definition, creating duplicated domain logic that will drift if severity levels or their ordering change.

Score: 1.00 (raw 1) · Passed: true · Hard failure: false
Latency: 5797 ms · Tokens: 3164 in / 445 out

| # | Category (raw → normalized) | Severity | Confidence | File:Line | Match method | Classification | Matched id |
|---|---|---|---|---|---|---|---|
| 0 | duplication.domain-logic-duplicated | P1 | high | release-judge.ts:3 | canonical_category_location | matched_required | req-1 |

<details><summary>Raw evidence text per finding (verbatim, for auditing hallucination/fabrication classifications)</summary>

- **#0** (matched_required): Both release-judge.ts and dashboard-summary.ts independently declare the same `SEVERITY_ORDER = ["NIT", "P2", "P1", "P0"]` array to encode the domain rule for severity ranking. This is a piece of domain policy (how severities compare) duplicated in two separate files instead of being defined once and imported/shared. If the severity set or ordering changes, one copy could be updated while the other is missed, causing the release judge and dashboard summary to silently disagree on severity ranking.

</details>

### `layer-boundaries-01-repository-imports-ui-component`

Summary: The SupabaseReviewRepository adapter (infrastructure layer) imports and invokes a React UI component (RepositoryCard) directly, and embeds the resulting UI output into the domain Repository object returned from a data-access method. This inverts the expected dependency direction (UI should depend on data/domain layers, not vice versa) and couples the persistence adapter to presentation concerns.

Score: 1.00 (raw 1) · Passed: true · Hard failure: false
Latency: 9171 ms · Tokens: 3016 in / 815 out

| # | Category (raw → normalized) | Severity | Confidence | File:Line | Match method | Classification | Matched id |
|---|---|---|---|---|---|---|---|
| 0 | layer-boundaries.cross-layer-import | P1 | high | supabase-adapter.ts:2-8 | canonical_category_location | matched_required | req-1 |

<details><summary>Raw evidence text per finding (verbatim, for auditing hallucination/fabrication classifications)</summary>

- **#0** (matched_required): supabase-adapter.ts, an infrastructure-layer repository implementation, imports `RepositoryCard` from `@/components/dashboard/repository-card` and calls it inside `listRepositoriesForUser` to build a `displayCard` field on the returned domain object: `rows.map((row) => ({ ...row, displayCard: RepositoryCard({ repository: row }) }))`. This makes the data-access layer depend on the presentation layer, inverting the correct dependency direction (UI -> domain/data, not data -> UI). It also leaks a UI-rendering responsibility into what should be a pure data-fetching adapter, and pollutes the `Repository` domain type with a presentation-specific `displayCard` property.

</details>

### `provider-leakage-01-domain-type-imports-vendor-sdk-type`

Summary: The new types.ts file, which defines core domain types (Severity, Finding), directly imports and embeds a vendor SDK type (Anthropic.Messages.Message) as a field on the domain Finding interface. This leaks a third-party provider's concrete type into the domain layer, coupling domain models to a specific vendor SDK.

Score: 1.00 (raw 1) · Passed: true · Hard failure: false
Latency: 6913 ms · Tokens: 2898 in / 600 out

| # | Category (raw → normalized) | Severity | Confidence | File:Line | Match method | Classification | Matched id |
|---|---|---|---|---|---|---|---|
| 0 | provider-leakage.vendor-type-in-domain | P1 | high | types.ts:1-10 | canonical_category_location | matched_required | req-1 |

<details><summary>Raw evidence text per finding (verbatim, for auditing hallucination/fabrication classifications)</summary>

- **#0** (matched_required): The domain-level `Finding` interface directly references `Anthropic.Messages.Message` from the `@anthropic-ai/sdk` package via the `rawProviderMessage` field. This couples the domain model to a specific vendor's SDK type, meaning any change to the Anthropic SDK's message shape (or a switch to a different LLM provider) forces changes to core domain types. Domain/business types should not depend on external provider SDKs; provider-specific data should be mapped to a domain-owned representation (or kept entirely within an infrastructure/adapter layer) before crossing into the domain.

</details>

### `responsibility-separation-01-business-logic-in-server-action`

Summary: The new finalize-review.ts server action embeds domain-level verdict/business policy (required reviewer checks, P0 severity gating, verdict determination) directly inside a "use server" action that also talks straight to the repository via getReviewRepository(). This mixes orchestration, domain policy, and persistence access in a single presentation-layer entry point instead of delegating to a domain/service layer, so the review-approval policy is not owned by a domain module and can't be reused or tested independently of the server-action/framework layer.

Score: 1.00 (raw 1) · Passed: true · Hard failure: false
Latency: 11879 ms · Tokens: 3141 in / 864 out

| # | Category (raw → normalized) | Severity | Confidence | File:Line | Match method | Classification | Matched id |
|---|---|---|---|---|---|---|---|
| 0 | responsibility-separation.business-logic-leakage | P1 | medium | finalize-review.ts:1-22 | canonical_category_location | matched_required | req-1 |

<details><summary>Raw evidence text per finding (verbatim, for auditing hallucination/fabrication classifications)</summary>

- **#0** (matched_required): The `finalizeReview` server action directly computes the review verdict (checking required reviewer completion and P0 findings) using hardcoded business rules (`const requiredReviewers = ["code", "security", "database"];` and the P0 gating logic), and it also calls `getReviewRepository()` itself to fetch the review. This puts domain/business logic and data-access orchestration in the transport/action layer rather than in a domain or application service that the action would merely invoke. As a result the approval policy is coupled to the server-action layer, cannot be reused by other callers (e.g. background jobs, other API surfaces), and there is no clear domain module that owns 'what makes a review approvable'.

</details>

### `safe-01-caching-decorator-follows-ports-pattern`

Summary: This diff adds a decorator implementing the ReviewRepository port, correctly wrapping an inner repository via constructor injection without leaking infrastructure details or importing outside its layer. No architectural boundary, coupling, or responsibility-placement defects are evident in this small, self-contained file.

Score: 1.00 (raw 1) · Passed: true · Hard failure: false
Latency: 3464 ms · Tokens: 3279 in / 109 out

No findings produced.

### `safe-02-type-only-cross-layer-import-is-fine`

Summary: This diff adds a small presentation component that imports a type-only definition from the domain layer using TypeScript's `import type`. This is a compile-time-only reference with no runtime dependency or coupling to domain infrastructure, so it does not constitute a genuine layer-boundary violation. No architectural defects are demonstrated in this change.

Score: 1.00 (raw 1) · Passed: true · Hard failure: false
Latency: 2733 ms · Tokens: 2889 in / 121 out

No findings produced.

### `transaction-orchestration-01-multi-step-business-transaction-in-adapter`

Summary: The SupabaseReviewRepository adapter, which implements a persistence port (ReviewRepository), contains a full multi-step business transaction (marking a review running, inserting findings, computing a verdict, persisting the verdict) including the actual verdict-determination policy. This orchestration and domain policy belong in an application/domain service that calls the repository for each step, not inside the infrastructure adapter itself.

Score: 1.00 (raw 1) · Passed: true · Hard failure: false
Latency: 12949 ms · Tokens: 3169 in / 1047 out

| # | Category (raw → normalized) | Severity | Confidence | File:Line | Match method | Classification | Matched id |
|---|---|---|---|---|---|---|---|
| 0 | transaction-orchestration.misplaced-in-adapter | P1 | high | supabase-adapter.ts:5-12 | canonical_category_location | matched_required | req-1 |

<details><summary>Raw evidence text per finding (verbatim, for auditing hallucination/fabrication classifications)</summary>

- **#0** (matched_required): `completeReviewWithFindings` in `SupabaseReviewRepository` (an infrastructure adapter implementing the `ReviewRepository` port) coordinates a multi-step business workflow: marking the review running, looping to insert each finding, computing the review verdict from finding severities, and persisting that verdict. This puts both process orchestration (sequencing multiple persistence operations) and domain policy (the APPROVE/DO_NOT_APPROVE rule based on P0 severity) inside the adapter layer instead of an application/domain service that would call narrower repository methods. This couples the workflow's correctness to a single concrete adapter, duplicates domain policy logic outside the domain layer, and makes it impossible to reuse or test the workflow independent of Supabase-specific persistence.

</details>

## Failure pattern summary

| Failure reason | Fixture count |
|---|---|
| duplicate root cause | 1 |

