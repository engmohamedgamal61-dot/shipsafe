# Security Reviewer v2 — Benchmark Fixtures

Deterministic, filesystem-based test fixtures for evaluating the
Security Reviewer v2 (`docs/agents/security-reviewer-v2.md`) against
the plan in `docs/agents/security-benchmark-plan.md`.

This directory contains **fixtures only** — no scoring/grading logic
lives here. Fixture parsing and validation is implemented separately
under `src/server/security-benchmarks/` (deliberately outside
`src/server/review-engine/`, so it is never imported by, or confused
with, the production reviewer).

## Layout

```
tests/security-benchmarks/
  <domain>/
    <NN-fixture-slug>/
      expected.json     # machine-readable ground truth (see schema.ts)
      explanation.md     # human-readable rationale, not parsed by tooling
      fixture/
        <source files>   # exactly the files expected.json's "files" list names
```

Each `<domain>` matches a §3 subsection of the spec (e.g. `access-control`
= §3.1, `injection` = §3.3, `llm-ai` = §3.17). `<NN>` numbers fixtures
within their own domain directory, starting at `01`.

## Why fixture source files are excluded from typecheck/lint

Files under any `fixture/` directory here are deliberately minimal,
illustrative vulnerable/safe/ambiguous code samples written to exercise
one specific finding — they are never imported or executed by the app,
and are not written to lint or typecheck cleanly (a fixture demonstrating
an injection bug, for instance, is the vulnerable code on purpose). Both
`tsconfig.json`'s `exclude` and `eslint.config.mjs`'s `globalIgnores`
therefore exclude `tests/security-benchmarks/**/fixture/**` specifically
— `expected.json`/`explanation.md` files are unaffected (they aren't
`.ts`/`.tsx` and were never swept in).

## Validating fixtures

`src/server/security-benchmarks/load-fixtures.ts` exports
`validateAllFixtures()`, which discovers every fixture under this
directory, validates its `expected.json` against the Zod schema in
`schema.ts`, and confirms every file the manifest declares actually
exists on disk under that fixture's `fixture/` directory (the
hallucinated-file-path check). See
`src/server/security-benchmarks/load-fixtures.test.ts` for usage.

This layer performs **no scoring** — it only answers "is this fixture
well-formed and internally consistent." Running a reviewer against a
fixture and grading its output per the plan's §4 scoring model is a
separate, not-yet-implemented piece of infrastructure.
