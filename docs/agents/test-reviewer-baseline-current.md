# Test Reviewer — Current Production Compatibility Baseline

**This is a compatibility baseline of the CURRENT production Test Reviewer, measured as-shipped.**

This report measures `src/server/review-engine/agents/test-reviewer.ts` exactly as it exists today, against the 10 fixtures under `tests/test-reviewer-benchmarks/`. No prompt, provider, or scoring change was made based on this run's results.

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
| Test Reviewer benchmark schema version | `1.1.0` |
| Test Reviewer benchmark dataset version | `phase1-10-of-10` |
| Test Reviewer prompt version | `untracked-first-baseline-pass` |
| Run timestamp | 2026-09-19T18:18:24.196Z |

## Methodology

- Each fixture's full source file(s) are wrapped in a synthetic "new file" unified diff (every line a `+` addition, numbered from 1) — see `baseline/context.ts`.
- The unmodified production `TestReviewerAgent` + `AnthropicProvider` classes are invoked directly — this harness never re-implements reviewer logic.
- `ReviewOrchestrator`'s other four specialist reviewers and Release Judge are NOT invoked — only the Test Reviewer is graded.
- A one-retry policy mirroring `ReviewOrchestrator.withRetry` is reproduced locally.
- Fixtures ran sequentially (concurrency 1), each independently.

## Aggregate metrics

| Metric | Value |
|---|---|
| Fixtures run | 10 |
| Fixtures passed | 8 |
| Fixtures with a hard failure | 0 |
| Precision | 80.0% |
| Recall | 100.0% |
| P0 recall | 100.0% |
| P1 recall | 100.0% |
| Safe-code false-positive rate | 100.0% |
| Ambiguous-case overclaim rate | 0.0% |
| Hallucinated-path rate | 0.0% |
| Fabricated-evidence rate | 0.0% |
| Duplicate rate | 0.0% |
| Severity accuracy | 100.0% |
| Category accuracy | 85.7% |
| Confidence calibration | high 100.0% (n=6) · medium 50.0% (n=2) · low 50.0% (n=2) |
| Average latency | 11794 ms |
| Total token usage | 28826 in / 10094 out |

## Per-fixture results

| Fixture | Domain | Tags | Status | Pass | Score | Required missed | Failure reasons |
|---|---|---|---|---|---|---|---|
| `ambiguous-01-message-text-changed-tests-not-shown` | ambiguous | ambiguous | scored | ✅ | 1.00 | — | — |
| `async-mistakes-01-missing-await-on-rejection-assertion` | async-mistakes | buggy | scored | ✅ | 1.00 | — | — |
| `brittle-tests-01-asserts-internal-call-count` | brittle-tests | buggy | scored | ✅ | 1.00 | — | — |
| `duplicated-tests-01-three-tests-assert-the-same-thing` | duplicated-tests | buggy | scored | ✅ | 1.00 | — | — |
| `missing-error-path-01-only-happy-path-tested` | missing-error-path | buggy | scored | ✅ | 1.00 | — | — |
| `missing-tests-01-critical-behavior-added-without-tests` | missing-tests | buggy | scored | ✅ | 1.00 | — | — |
| `mock-fidelity-01-mock-hides-real-integration-contract` | mock-fidelity | buggy | scored | ✅ | 1.00 | — | — |
| `safe-01-comprehensive-test-suite` | safe | safe, false_positive_trap | scored | ❌ | 0.50 | — | false positive |
| `safe-02-legitimate-clock-mock` | safe | safe, false_positive_trap | scored | ❌ | 0.50 | — | false positive |
| `weak-assertions-01-tautological-assertion-proves-nothing` | weak-assertions | buggy | scored | ✅ | 1.00 | — | — |

### `ambiguous-01-message-text-changed-tests-not-shown`

Summary: The diff introduces a new validateSignUpPassword function but contains no test file changes. The PR title suggests the error message text was changed, which could silently break any existing tests that assert on the exact message string, but since no test files are included in this diff, this cannot be confirmed one way or the other.

Score: 1.00 (raw 1) · Passed: true · Hard failure: false
Latency: 9349 ms · Tokens: 2808 in / 776 out

| # | Category (raw → normalized) | Severity | Confidence | File:Line | Match method | Classification | Matched id |
|---|---|---|---|---|---|---|---|
| 0 | missing-tests.critical-behavior | P2 | low | sign-up-validation.ts:1-6 | canonical_category_location | matched_optional | opt-1 |

<details><summary>Raw evidence text per finding (verbatim, for auditing hallucination/fabrication classifications)</summary>

- **#0** (matched_optional): This diff adds sign-up-validation.ts with a new exported function validateSignUpPassword that returns a specific error message string "Passwords must match exactly." when passwords don't match. No test file is included in this diff. The PR title indicates the message text was changed, which is a strong signal that some test elsewhere may assert on the exact message text and could now be broken or need updating. However, since test files are not shown in this diff, it is not possible to confirm whether such tests exist, whether they were updated, or whether they are missing entirely.

</details>

### `async-mistakes-01-missing-await-on-rejection-assertion`

Summary: The single test added in this diff has a critical async-testing defect: the promise returned by `expect(ingestPullRequest(null)).rejects.toThrow();` is neither awaited nor returned, and the `it` callback itself is not declared `async`. This means Vitest will not wait for the rejection assertion to resolve before considering the test complete, so the test can report as passing even if `ingestPullRequest` never rejects (or throws synchronously, resolves, or the assertion itself fails). This makes the test unable to reliably catch a regression in the error-handling behavior it's meant to verify.

Score: 1.00 (raw 1) · Passed: true · Hard failure: false
Latency: 10595 ms · Tokens: 2812 in / 939 out

| # | Category (raw → normalized) | Severity | Confidence | File:Line | Match method | Classification | Matched id |
|---|---|---|---|---|---|---|---|
| 0 | async-mistakes.missing-await | P1 | high | ingest.test.ts:5-7 | canonical_category_location | matched_required | req-1 |

<details><summary>Raw evidence text per finding (verbatim, for auditing hallucination/fabrication classifications)</summary>

- **#0** (matched_required): In the test `it("throws when the payload is invalid", () => { expect(ingestPullRequest(null)).rejects.toThrow(); });`, the `it` callback is a synchronous arrow function and the promise chain returned by `.rejects.toThrow()` is not awaited or returned. Vitest test runners only wait for a test to finish if the returned/awaited promise is provided; here the test function returns undefined immediately while the assertion promise resolves or rejects asynchronously afterward, unobserved. As a result, if `ingestPullRequest(null)` fails to reject (e.g., resolves successfully, or the rejection reason isn't an Error/doesn't match toThrow expectations), the test will still report as passing, silently hiding a real regression in the invalid-payload handling path.

</details>

### `brittle-tests-01-asserts-internal-call-count`

Summary: The single test added for finalizeReview only asserts that an internal helper (computeAutoMergeEligibility) was called exactly once via a spy on the module, but never asserts anything about finalizeReview's actual return value, side effects, or behavior. This couples the test to an implementation detail and leaves the function's real observable behavior—including any error/boundary handling—completely untested.

Score: 1.00 (raw 1) · Passed: true · Hard failure: false
Latency: 10135 ms · Tokens: 2876 in / 858 out

| # | Category (raw → normalized) | Severity | Confidence | File:Line | Match method | Classification | Matched id |
|---|---|---|---|---|---|---|---|
| 0 | brittle-tests.implementation-coupling | P1 | high | finalize-review.test.ts:7-10 | canonical_category_location | matched_required | req-1 |

<details><summary>Raw evidence text per finding (verbatim, for auditing hallucination/fabrication classifications)</summary>

- **#0** (matched_required): The test `expect(spy).toHaveBeenCalledTimes(1);` spies on `verdictModule.computeAutoMergeEligibility` and only checks that it was invoked once. It never asserts on the return value of `finalizeReview("review-1")`, nor on any side effects (e.g., what verdict was produced, what happens if the helper throws, or how different inputs affect the outcome). This means the test would pass even if finalizeReview's core logic were broken (e.g., ignoring the helper's result, or producing an incorrect final review outcome), while also being brittle to any internal refactor that changes how or whether this helper is called (e.g., renaming, inlining, or calling it a different number of times for legitimate reasons).

</details>

### `duplicated-tests-01-three-tests-assert-the-same-thing`

Summary: The new test file for totalReviewScore contains three tests that all exercise the exact same code path (summing exactly two positive integers) with only the literal values changed, providing no additional coverage. No boundary or error conditions (empty array, single element, negative numbers, non-numeric input) are tested.

Score: 1.00 (raw 1) · Passed: true · Hard failure: false
Latency: 8430 ms · Tokens: 2896 in / 709 out

| # | Category (raw → normalized) | Severity | Confidence | File:Line | Match method | Classification | Matched id |
|---|---|---|---|---|---|---|---|
| 0 | duplicated-tests.redundant-coverage | P2 | high | score.test.ts:5-15 | canonical_category_location | matched_required | req-1 |

<details><summary>Raw evidence text per finding (verbatim, for auditing hallucination/fabrication classifications)</summary>

- **#0** (matched_required): The three test cases 'sums two scores', 'sums two other scores', and 'sums yet another pair of scores' all call totalReviewScore with a two-element array of positive integers and assert the sum. They exercise identical logic paths and differ only in input/output values, so two of the three tests add no incremental coverage.

</details>

### `missing-error-path-01-only-happy-path-tested`

Summary: The new score.test.ts only exercises a single happy-path case (summing [1,2,3]) for totalReviewScore. The implementation uses Array.reduce without an initial accumulator, which throws a TypeError at runtime when called with an empty array, and no test covers this failure mode or other boundary inputs (single-element array, negative numbers). This is a concrete, demonstrated gap given the production code's behavior.

Score: 1.00 (raw 1) · Passed: true · Hard failure: false
Latency: 7080 ms · Tokens: 2894 in / 644 out

| # | Category (raw → normalized) | Severity | Confidence | File:Line | Match method | Classification | Matched id |
|---|---|---|---|---|---|---|---|
| 0 | missing-error-path.untested-failure-mode | P1 | high | score.test.ts:5-7 | canonical_category_location | matched_required | req-1 |

<details><summary>Raw evidence text per finding (verbatim, for auditing hallucination/fabrication classifications)</summary>

- **#0** (matched_required): totalReviewScore is implemented as [unverified quote removed] with no initial value. Per Array.prototype.reduce semantics, calling this with an empty array throws 'TypeError: Reduce of empty array with no initial value'. The test suite added in score.test.ts only calls `totalReviewScore([1, 2, 3])` and asserts the happy-path sum, so this runtime failure mode is completely unverified and could ship undetected.

</details>

### `missing-tests-01-critical-behavior-added-without-tests`

Summary: The diff adds a new exported function computeAutoMergeEligibility that implements critical auto-merge eligibility logic (gating whether a PR can be auto-merged based on verdict and finding severities), but no test file is included anywhere in the diff. This is a single, clear-cut critical-behavior-without-tests gap.

Score: 1.00 (raw 1) · Passed: true · Hard failure: false
Latency: 7385 ms · Tokens: 2796 in / 582 out

| # | Category (raw → normalized) | Severity | Confidence | File:Line | Match method | Classification | Matched id |
|---|---|---|---|---|---|---|---|
| 0 | missing-tests.critical-behavior | P1 | high | verdict.ts:1-5 | canonical_category_location | matched_required | req-1 |

<details><summary>Raw evidence text per finding (verbatim, for auditing hallucination/fabrication classifications)</summary>

- **#0** (matched_required): verdict.ts introduces computeAutoMergeEligibility, which controls whether a PR is eligible for auto-merge based on verdict string and finding severities — a decision with direct safety impact (an incorrect result could allow a PR with unresolved P0/P1 findings to be auto-merged, or block merges that should be allowed). The diff contains no accompanying test file, so there is no verification of the happy path (APPROVE verdict with no P0/P1 findings), the negative path (non-APPROVE verdict), the blocking path (P0 or P1 present), or boundary/edge cases (empty findings array, verdict values other than 'APPROVE' such as lowercase or REJECT, findings with only P2/NIT severities).

</details>

### `mock-fidelity-01-mock-hides-real-integration-contract`

Summary: The new test file for attachLatestReviewStatus contains a single happy-path test with a mock that returns a fixed result regardless of input, and no coverage for error responses, empty/mismatched results, or multiple pull requests, leaving important failure and edge-case behavior unverified.

Score: 1.00 (raw 1) · Passed: true · Hard failure: false
Latency: 22234 ms · Tokens: 2985 in / 1903 out

| # | Category (raw → normalized) | Severity | Confidence | File:Line | Match method | Classification | Matched id |
|---|---|---|---|---|---|---|---|
| 0 | missing-error-path.untested-failure-mode | P1 | medium | attach-review-status.test.ts:5-18 | canonical_category_location | matched_required | req-1 |

<details><summary>Raw evidence text per finding (verbatim, for auditing hallucination/fabrication classifications)</summary>

- **#0** (matched_required): The only test in the suite mocks `.in()` to always resolve with `{ data: [{ pull_request_id: "pr-1", status: "APPROVE" }], error: null }` and asserts `result[0].status` equals "APPROVE". There is no test exercising the case where the query returns `error` set (a Supabase failure) or where `data` is empty/does not contain a matching pull_request_id, both of which are realistic outcomes attachLatestReviewStatus must handle (e.g. leaving status undefined/null or throwing). A regression that silently swallows errors or crashes on missing matches would not be caught by this suite.

</details>

### `safe-01-comprehensive-test-suite`

Summary: The added test suite for totalReviewScore covers sum, single-element, empty-array, and negative-number cases, which is reasonable given the demonstrated scope. One notable weakness is the empty-array error test uses a bare toThrow() assertion, which doesn't verify what error/message is thrown, so it would pass even if the implementation started throwing a wrong or unrelated error.

Score: 0.50 (raw -2) · Passed: false · Hard failure: false
Latency: 11840 ms · Tokens: 2927 in / 1057 out

| # | Category (raw → normalized) | Severity | Confidence | File:Line | Match method | Classification | Matched id |
|---|---|---|---|---|---|---|---|
| 0 | weak-assertions.tautological | P2 | medium | score.test.ts:15-17 | unmatched | prohibited | — |

<details><summary>Raw evidence text per finding (verbatim, for auditing hallucination/fabrication classifications)</summary>

- **#0** (prohibited): The test `expect(() => totalReviewScore([])).toThrow();` only checks that some error is thrown, not that it's the expected error (e.g., a specific message or error class). This makes the test weak: any thrown error—even an unrelated bug like a TypeError from unrelated code—would satisfy the assertion, so a regression that changes the error semantics (or accidentally throws a different, unintended error) would not be caught.

</details>

### `safe-02-legitimate-clock-mock`

Summary: The new staleness.test.ts adds two time-based tests for isReviewStale using vi.setSystemTime, exercising a case well past the apparent staleness cutoff and a case well before it. The test file is small and does not include a case at the exact threshold boundary or any coverage for invalid/missing completedAt input, which are typical risk areas for time-based staleness logic. Since the isReviewStale implementation itself is not included in this diff, the exact threshold value and whether boundary/negative-input behavior is meaningful cannot be confirmed here.

Score: 0.50 (raw -2) · Passed: false · Hard failure: false
Latency: 22197 ms · Tokens: 3001 in / 1875 out

| # | Category (raw → normalized) | Severity | Confidence | File:Line | Match method | Classification | Matched id |
|---|---|---|---|---|---|---|---|
| 0 | missing-tests.critical-behavior | P2 | low | staleness.test.ts:8-19 | unmatched | prohibited | — |

<details><summary>Raw evidence text per finding (verbatim, for auditing hallucination/fabrication classifications)</summary>

- **#0** (prohibited): The two tests only check a point far past the staleness cutoff (24h difference, expected true) and a point well before it (1h difference, expected false). There is no test exercising the value exactly at the staleness threshold, which is the classic off-by-one risk for date/time comparison logic (e.g. `>` vs [unverified quote removed]). There is also no test for how isReviewStale behaves when completedAt is missing, null, or an unparsable date string. Because staleness.ts is not part of this diff, it's not possible to confirm from the available code whether such edge cases are trivial (and thus low-value to test) or whether they represent real behavior differences.

</details>

### `weak-assertions-01-tautological-assertion-proves-nothing`

Summary: The new test file for computeAutoMergeEligibility contains a single test with a tautological assertion that does not verify actual behavior, and there is no coverage of the function's real decision logic or error/boundary cases.

Score: 1.00 (raw 1) · Passed: true · Hard failure: false
Latency: 8699 ms · Tokens: 2831 in / 751 out

| # | Category (raw → normalized) | Severity | Confidence | File:Line | Match method | Classification | Matched id |
|---|---|---|---|---|---|---|---|
| 0 | weak-assertions.tautological | P1 | high | verdict.test.ts:5-8 | canonical_category_location | matched_required | req-1 |

<details><summary>Raw evidence text per finding (verbatim, for auditing hallucination/fabrication classifications)</summary>

- **#0** (matched_required): The test calls `computeAutoMergeEligibility("APPROVE", [])` and only asserts `expect(result).toBeDefined()`. Since the function is documented/named to return a boolean, `toBeDefined()` would pass for virtually any non-undefined return value (true, false, an object, a string, etc.), so this test provides no real verification that the function computes the correct auto-merge eligibility for an APPROVE verdict with no other inputs. This test would pass even if the function's logic were completely broken or returned the wrong boolean.

</details>

## Failure pattern summary

| Failure reason | Fixture count |
|---|---|
| false positive | 2 |

