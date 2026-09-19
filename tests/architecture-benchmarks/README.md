# Architecture Reviewer benchmark

A 10-fixture benchmark suite for `src/server/review-engine/agents/architecture-reviewer.ts`,
built with the same disciplined methodology as `tests/code-benchmarks/`,
`tests/security-benchmarks/`, and `tests/database-benchmarks/`, and kept
**fully independent** of all three: independent
schema/scorer/adapter/category-compat/confidence-mapping under
`src/server/architecture-benchmarks/`, independent fixture tree here,
independent baseline artifacts
(`docs/agents/architecture-baseline-current.md`,
`artifacts/architecture-benchmark/current-baseline.json`).

## Why a fourth, separate benchmark instead of sharing one

Same reasoning as the other three benchmarks' READMEs: the Architecture
Reviewer's categories (`layer-boundaries.*`, `responsibility-separation.*`,
`coupling.*`, `circular-dependency.*`, `duplication.*`,
`transaction-orchestration.*`, `provider-leakage.*`) are a different
taxonomy from the Code, Security, and Database reviewers', and a shared
scorer would either force an artificial mapping between unrelated
domains or grow an ever-larger union of special cases. Each benchmark
owns its own copy of the (structurally identical, but independently
maintained) scoring architecture instead.

This codebase's own real structure — a genuine ports/adapters
architecture (`src/server/repositories/ports.ts`, `src/server/container.ts`
as the composition root, `src/domain/` as the dependency-free core) — is
what every fixture's realistic file paths and import patterns are
modeled on, so fixtures reflect the kind of violation that could
plausibly appear in a PR against this exact codebase.

## Fixture layout

```
<domain>/<NN>-<slug>/
  expected.json    — ground truth (required/optional findings, severity
                      range, confidence range, canonical category,
                      alternate categories, allowed/prohibited categories)
  explanation.md    — human-readable rationale: why the defect is real,
                      why a "safe" fixture is safe, or what's genuinely
                      unconfirmable in an ambiguous fixture
  fixture/*.ts|tsx  — the actual module(s) under review (some fixtures
                      are multi-file, e.g. a circular-dependency pair)
```

`fixture/**` is excluded from `tsconfig.json` and `eslint.config.mjs` —
these are minimal, illustrative snippets (some deliberately import a
sibling module or vendor SDK type that isn't real in the fixture set,
since only the shown module's own structure is under test) — never
compiled or linted as part of the app.

## The 10 fixtures (7 buggy : 2 safe : 1 ambiguous — same ratio as the other three benchmarks)

| Fixture | Archetype(s) covered | Ground truth |
|---|---|---|
| `layer-boundaries/01-repository-imports-ui-component` | broken layer boundary, dependency-direction violation, cross-layer import | a persistence adapter imports and calls a React UI component |
| `responsibility-separation/01-business-logic-in-server-action` | business logic leaking into a controller, incorrect controller boundary | a Server Action reimplements the verdict policy inline |
| `coupling/01-repository-bypasses-port-for-provider` | inappropriate coupling, incorrect repository boundary | a repository directly instantiates a concrete `AnthropicProvider` |
| `circular-dependency/01-mutual-imports-between-services` (multi-file) | circular dependency risk, evidenced | `ingest.ts` and `seed.ts` import each other |
| `duplication/01-severity-order-duplicated-across-modules` (multi-file) | duplicated domain logic across modules | the same `SEVERITY_ORDER` array defined independently in two files |
| `transaction-orchestration/01-multi-step-business-transaction-in-adapter` | transaction orchestration in the wrong layer | a persistence adapter method sequences writes and computes the verdict itself |
| `provider-leakage/01-domain-type-imports-vendor-sdk-type` | provider-specific logic leaking into domain code | the domain `Finding` type embeds an Anthropic SDK type |
| `safe/01-caching-decorator-follows-ports-pattern` (safe) | safe architectural pattern; scalability without evidence is not flagged | a correct decorator implementing an existing port; zero findings |
| `safe/02-type-only-cross-layer-import-is-fine` (safe) | poor responsibility separation avoided; false-positive trap | a UI component importing a domain TYPE — the correct dependency direction |
| `ambiguous/01-shared-utility-module-unclear-ownership` (ambiguous) | scalability/ownership concern, genuinely unconfirmable | a utility function that might encode business policy, or might not |

### Coverage note (10-fixture cap)

The task's requested archetype list has more distinct bullets than
fixture slots. Several fixtures deliberately demonstrate more than one
requested archetype at once where they are naturally the same root
cause (e.g. "broken layer boundaries," "dependency-direction
violations," and "cross-layer imports" are all the same underlying
defect in `layer-boundaries-01`; "incorrect service/repository/
controller boundaries" is covered by both `responsibility-separation-01`
and `coupling-01` from different angles). "Scalability/architecture
concerns only when concretely evidenced" is tested negatively — no
fixture requires the reviewer to invent a scale concern, and the safe/
ambiguous fixtures explicitly penalize doing so — rather than via a
dedicated "here is a real scale defect" fixture, consistent with the
instruction that such concerns should rarely be flagged at all.

## Scoring

Same classification model as `code-benchmarks/scorer.ts`
(`matched_required` / `matched_optional` / `duplicate` / `prohibited` /
`unsupported_extra` / `hallucinated_path` / `fabricated_evidence`),
including the FIXED, proven fabrication-detection logic (case-insensitive
verbatim matching, illustrative-example exemption, verified dotted/bare
method-reference exemption) — never weakened relative to the other
three benchmarks. Metrics: precision, recall, P0/P1 recall, safe-code
false-positive rate, ambiguous-overclaim rate, duplicate rate,
fabricated-evidence rate, hallucinated-path rate, severity accuracy,
category accuracy.

## Running the live baseline

```
RUN_LIVE_ARCHITECTURE_BASELINE=1 node --env-file=.env.local node_modules/.bin/vitest run src/server/architecture-benchmarks/baseline/run.live.test.ts
```

Never runs as part of `npm test` — costs real money and hits a real
external API. Invokes the current, unmodified production
`ArchitectureReviewerAgent` + `AnthropicProvider` directly (never the
full `ReviewOrchestrator`, to avoid paying for the other four specialist
reviewers' output this benchmark doesn't grade).
