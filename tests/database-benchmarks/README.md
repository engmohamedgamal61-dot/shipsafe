# Database Reviewer benchmark

A 10-fixture benchmark suite for `src/server/review-engine/agents/database-reviewer.ts`,
built with the same disciplined methodology as `tests/code-benchmarks/`
and `tests/security-benchmarks/`, and kept **fully independent** of both:
independent schema/scorer/adapter/category-compat/confidence-mapping
under `src/server/database-benchmarks/`, independent fixture tree here,
independent baseline artifacts (`docs/agents/database-baseline-current.md`,
`artifacts/database-benchmark/current-baseline.json`).

## Why a third, separate benchmark instead of sharing one

Same reasoning as `tests/code-benchmarks/README.md`: the Database
Reviewer's categories (`foreign-keys.*`, `nullability.*`,
`cascade-delete.*`, `race-condition.*`, `migration-safety.*`,
`performance.*`, `transaction-boundary.*`, `tenant-isolation.*`) are a
different taxonomy from both the Code Reviewer's and the Security
Reviewer's, and a shared scorer would either force an artificial mapping
between unrelated domains or grow an ever-larger union of special cases.
Each benchmark owns its own copy of the (structurally identical, but
independently maintained) scoring architecture instead.

## Fixture layout

```
<domain>/<NN>-<slug>/
  expected.json    — ground truth (required/optional findings, severity
                      range, confidence range, canonical category,
                      alternate categories, allowed/prohibited categories)
  explanation.md    — human-readable rationale: why the defect is real,
                      why a "safe" fixture is safe, or what's genuinely
                      unconfirmable in an ambiguous fixture
  fixture/*.sql|.ts — the actual migration or query code under review
```

`fixture/**` is excluded from `tsconfig.json` and `eslint.config.mjs` —
these are minimal, illustrative snippets (some using a service-client
import path that isn't a real module in this fixture set), never
compiled or linted as part of the app.

## The 10 fixtures (7 buggy : 2 safe : 1 ambiguous — same ratio as `code-benchmarks`)

| Fixture | Archetype(s) covered | Ground truth |
|---|---|---|
| `foreign-keys/01-missing-foreign-key-reference` | missing FK | `webhook_deliveries.repository_id` has no `references` clause |
| `nullability/01-required-column-nullable` | nullable column that shouldn't be | `invoices.amount_cents` is nullable while its siblings are `not null` |
| `cascade-delete/01-unsafe-cascade-destroys-audit-trail` | unsafe cascade | `actor_id on delete cascade` erases a compliance audit log |
| `race-condition/01-missing-unique-constraint-duplicate-invite` | race-condition + missing unique constraint | no `unique (workspace_id, email)` on `workspace_invitations` |
| `migration-safety/01-unsafe-not-null-without-backfill` | migration safety | `add column ... not null` with no default on a populated table |
| `query-performance/01-n-plus-one-loop-query` | N+1 with concrete evidence | a `reviews` query issued once per iteration inside a `for` loop |
| `transaction-boundary/01-non-atomic-ownership-transfer` | transaction-boundary | two independent, sequential `.update()` calls transferring ownership |
| `safe-migration/01-scoped-uniqueness-and-correct-cascades` (safe) | safe schema example; correct tenant-scoped uniqueness | zero findings expected |
| `reviewer-lane/01-schema-correct-tenant-table-no-rls` (safe) | RLS/tenant-isolation lane discipline | a schema-correct table with no RLS — Security Reviewer's job, not Database Reviewer's |
| `ambiguous/01-index-build-lock-risk-unknown-table-size` (ambiguous) | migration safety, genuinely unconfirmable | `CREATE INDEX` lock risk depends on unseen table size/traffic |

### Coverage note (10-fixture cap)

The task's requested archetype list has more distinct bullets (14) than
fixture slots (10). `race-condition` + `missing unique constraint` share
one fixture (they are the same root cause: a missing constraint enables
the race), `N+1` + `query inefficiency with concrete evidence` share one
fixture, and `data-integrity violations` is covered collectively by the
foreign-key/nullability/cascade/race fixtures rather than a dedicated
one. `schema/data-type mismatches` and fine-grained "missing index
without access-pattern evidence" negative-space testing receive lighter,
indirect coverage (the latter via the ambiguous fixture's explicit
"don't assume production traffic" framing) rather than a dedicated
fixture, consistent with `code-benchmarks`' own "balanced mix, not
exhaustive" precedent for a fixed-size suite.

## Scoring

Same classification model as `code-benchmarks/scorer.ts`
(`matched_required` / `matched_optional` / `duplicate` / `prohibited` /
`unsupported_extra` / `hallucinated_path` / `fabricated_evidence`),
including the FIXED, proven fabrication-detection logic (case-insensitive
verbatim matching, illustrative-example exemption, verified dotted/bare
method-reference exemption) — never weakened relative to the other two
benchmarks. Metrics: precision, recall, P0/P1 recall, safe-code
false-positive rate, ambiguous-overclaim rate, duplicate rate,
fabricated-evidence rate, hallucinated-path rate, severity accuracy,
category accuracy.

## Running the live baseline

```
RUN_LIVE_DATABASE_BASELINE=1 node --env-file=.env.local node_modules/.bin/vitest run src/server/database-benchmarks/baseline/run.live.test.ts
```

Never runs as part of `npm test` — costs real money and hits a real
external API. Invokes the current, unmodified production
`DatabaseReviewerAgent` + `AnthropicProvider` directly (never the full
`ReviewOrchestrator`, to avoid paying for the other four specialist
reviewers' output this benchmark doesn't grade).
