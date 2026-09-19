# Code Reviewer — Benchmark Fixtures

Deterministic, filesystem-based test fixtures for evaluating the
production Code Reviewer (`src/server/review-engine/agents/code-reviewer.ts`),
using the same methodology as `tests/security-benchmarks/` — but
scored, versioned, and normalized completely independently (see
`src/server/code-benchmarks/`, never `src/server/security-benchmarks/`).

This directory contains **fixtures only** — no scoring/grading logic
lives here. Fixture parsing and validation is implemented separately
under `src/server/code-benchmarks/`.

## Layout

```
tests/code-benchmarks/
  <domain>/
    <NN-fixture-slug>/
      expected.json     # machine-readable ground truth (see schema.ts)
      explanation.md     # human-readable rationale, not parsed by tooling
      fixture/
        <source files>   # exactly the files expected.json's "files" list names
```

## Why this benchmark is separate from `tests/security-benchmarks/`

The Code Reviewer and Security Reviewer are different specialists with
different taxonomies (correctness/maintainability/performance/etc. vs.
access-control/injection/secrets/etc.), different severity intuitions,
and different false-positive shapes (a Code Reviewer's "safe" trap is a
correct-but-repetitive-looking function; a Security Reviewer's is a
correctly-RLS-scoped query). Sharing one scorer/category-compat table
between them would blur two genuinely different review disciplines
together. What IS shared: the underlying `ProviderFinding`/`AgentReviewOutput`
domain types (`src/domain/schemas.ts`) both reviewers already emit, and
the general fixture/scoring ARCHITECTURE (ground-truth schema shape,
classification model, live-baseline-runner pattern) — `src/server/code-benchmarks/`
mirrors `src/server/security-benchmarks/`'s design deliberately, file by
file, but re-implements every domain-specific piece (categories, the
compatibility-mapping table, the fixture set) independently so the two
benchmarks can evolve on their own schedules without coupling.

## Phase 1 fixture set (10 fixtures)

| # | Fixture ID | Domain | Tags | What it tests |
|---|---|---|---|---|
| 1 | `correctness-01-off-by-one-pagination` | correctness | buggy | `slice(start, end + 1)` — a real, deterministic off-by-one that duplicates items across pages. |
| 2 | `correctness-02-safe-half-open-range` | correctness | safe, false_positive_trap | The same slice-with-addition SHAPE, used correctly — must not be pattern-matched as suspicious. |
| 3 | `maintainability-01-deep-nesting-duplication` | maintainability | buggy | Four-deep nesting + real structural duplication, functionally correct — tests severity calibration (Nit/P2, never a "bug"). |
| 4 | `refactor-trap-01-long-but-correct-switch` | refactor-trap | safe, false_positive_trap | An exhaustive, idiomatic switch over a literal union — repetitive-looking but not a defect; must not be "refactor"-suggested. |
| 5 | `performance-01-linear-scan-in-filter` | performance | buggy | `.filter()` + `.includes()` — a structurally-provable O(n*m) scan, no profiling needed. |
| 6 | `dead-code-01-unreachable-after-return` | dead-code | buggy | A statement after two unconditionally-returning branches — unambiguous unreachable code. |
| 7 | `error-handling-01-swallowed-exception-async` | error-handling | buggy | A catch block that discards the error and never rethrows — silent async failure. |
| 8 | `concurrency-01-foreach-async-no-await` | concurrency | buggy, concurrency | `Array.prototype.forEach` with an async callback — the textbook missing-await pitfall. |
| 9 | `edge-case-api-misuse-01-reduce-no-initial-value` | edge-case-api-misuse | buggy | `reduce()` with no initial value — crashes on the realistic empty-array case; both an edge-case and an API-misuse framing are accepted. |
| 10 | `ambiguous-01-unvalidated-discount-lookup` | ambiguous | ambiguous | A plausible defect whose confirmation depends on an imported function's contract, not shown here — correct answer is a hedge, not a confident claim. |

**Coverage against the requested archetype mix:** real code defects
(1, 3, 5–9), safe code (2, 4), ambiguous code (10), refactoring/code-smell
that must not be escalated (4), correctness bugs (1, and arguably several
others under a broad reading), maintainability issues (3), a
concrete-evidence performance issue (5), dead/unreachable logic (6),
an error-handling defect (7), an async/concurrency mistake (8),
edge-case handling and API misuse (9, deliberately combined in one
fixture since they're two valid framings of the identical root cause).

**Deliberately not security-focused** — no access-control, secrets,
injection, or webhook content anywhere in this fixture set; that's
`tests/security-benchmarks/`'s job.
