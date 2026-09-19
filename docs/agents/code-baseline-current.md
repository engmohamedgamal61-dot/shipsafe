# Code Reviewer — Current Production Compatibility Baseline

**This is a compatibility baseline of the CURRENT production Code Reviewer, measured as-shipped.**

This report measures `src/server/review-engine/agents/code-reviewer.ts` exactly as it exists today, against the 10 fixtures under `tests/code-benchmarks/`. No prompt, provider, or scoring change was made based on this run's results.

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
| Code benchmark schema version | `1.1.0` |
| Code benchmark dataset version | `phase1-10-of-10-r2` |
| Code reviewer prompt version | `untracked-first-baseline-pass` |
| Run timestamp | 2026-09-19T14:50:27.593Z |

## Methodology

- Each fixture's full source file(s) are wrapped in a synthetic "new file" unified diff (every line a `+` addition, numbered from 1) — see `baseline/context.ts`.
- The unmodified production `CodeReviewerAgent` + `AnthropicProvider` classes are invoked directly — this harness never re-implements reviewer logic.
- `ReviewOrchestrator`'s other four specialist reviewers and Release Judge are NOT invoked — only the Code Reviewer is graded.
- A one-retry policy mirroring `ReviewOrchestrator.withRetry` is reproduced locally.
- Fixtures ran sequentially (concurrency 1), each independently.

## Aggregate metrics

| Metric | Value |
|---|---|
| Fixtures run | 10 |
| Fixtures passed | 9 |
| Fixtures with a hard failure | 0 |
| Precision | 88.9% |
| Recall | 100.0% |
| P0 recall | 100.0% |
| P1 recall | 100.0% |
| Safe-code false-positive rate | 0.0% |
| Ambiguous-case overclaim rate | 100.0% |
| Hallucinated-path rate | 0.0% |
| Fabricated-evidence rate | 0.0% |
| Duplicate rate | 0.0% |
| Severity accuracy | 85.7% |
| Category accuracy | 100.0% |
| Confidence calibration | high 100.0% (n=7) · medium 50.0% (n=2) · low 100.0% (n=0) |
| Average latency | 9826 ms |
| Total token usage | 30665 in / 8287 out |

## Per-fixture results

| Fixture | Domain | Tags | Status | Pass | Score | Required missed | Failure reasons |
|---|---|---|---|---|---|---|---|
| `ambiguous-01-unvalidated-discount-lookup` | ambiguous | ambiguous | scored | ❌ | 0.67 | — | false positive, overconfidence |
| `concurrency-01-foreach-async-no-await` | concurrency | buggy, concurrency | scored | ✅ | 1.00 | — | — |
| `correctness-01-off-by-one-pagination` | correctness | buggy | scored | ✅ | 0.92 | — | severity inflation |
| `correctness-02-safe-half-open-range` | correctness | safe, false_positive_trap | scored | ✅ | 1.00 | — | — |
| `dead-code-01-unreachable-after-return` | dead-code | buggy | scored | ✅ | 1.00 | — | — |
| `edge-case-api-misuse-01-reduce-no-initial-value` | edge-case-api-misuse | buggy | scored | ✅ | 1.00 | — | — |
| `error-handling-01-swallowed-exception-async` | error-handling | buggy | scored | ✅ | 1.00 | — | — |
| `maintainability-01-deep-nesting-duplication` | maintainability | buggy | scored | ✅ | 1.00 | — | — |
| `performance-01-linear-scan-in-filter` | performance | buggy | scored | ✅ | 1.00 | — | — |
| `refactor-trap-01-long-but-correct-switch` | refactor-trap | safe, false_positive_trap | scored | ✅ | 1.00 | — | — |

### `ambiguous-01-unvalidated-discount-lookup`

Summary: The new applyDiscountCode function takes the result of lookupDiscount and directly subtracts it from cart.total without any validation of the returned value or bounds-checking on the result, which can lead to invalid cart states.

Score: 0.67 (raw -1) · Passed: false · Hard failure: false
Latency: 14598 ms · Tokens: 3043 in / 1447 out

| # | Category (raw → normalized) | Severity | Confidence | File:Line | Match method | Classification | Matched id |
|---|---|---|---|---|---|---|---|
| 0 | error-handling → error-handling.swallowed-exception | P2 | medium | apply-discount.ts:11-12 | unmatched | prohibited | — |

<details><summary>Raw evidence text per finding (verbatim, for auditing hallucination/fabrication classifications)</summary>

- **#0** (prohibited): `const discount = lookupDiscount(code);` is passed straight into `cart.total - discount` with no check that lookupDiscount returned a valid, defined numeric value. If lookupDiscount can return undefined/null for an invalid or unknown code (a common lookup pattern), the subtraction would silently produce NaN and corrupt the cart's total. The diff does not show discounts.ts, so the actual return contract of lookupDiscount is unconfirmed, but the calling code makes no defensive check regardless of that contract.

</details>

### `concurrency-01-foreach-async-no-await`

Summary: The new notify.ts contains the classic Array.prototype.forEach + async callback anti-pattern: forEach does not await the async callbacks, so notifyAllSubscribers resolves and logs completion before the notifications have actually been sent, and any rejection from sendNotification becomes an unhandled promise rejection instead of propagating to the caller.

Score: 1.00 (raw 1) · Passed: true · Hard failure: false
Latency: 9529 ms · Tokens: 3022 in / 646 out

| # | Category (raw → normalized) | Severity | Confidence | File:Line | Match method | Classification | Matched id |
|---|---|---|---|---|---|---|---|
| 0 | concurrency.missing-await | P1 | high | notify.ts:7-9 | canonical_category_location | matched_required | req-1 |

<details><summary>Raw evidence text per finding (verbatim, for auditing hallucination/fabrication classifications)</summary>

- **#0** (matched_required): `subscriberIds.forEach(async (id) => {
    await sendNotification(id);
  });` uses Array.prototype.forEach with an async callback. forEach ignores the promises returned by its callback and does not wait for them to settle. As a result, `notifyAllSubscribers` will log `console.log("all subscribers notified")` and resolve its returned promise immediately after scheduling the calls, without actually waiting for any of the sendNotification calls to complete. This contradicts the function's docstring, which promises to send a notification to every subscriber and log when done — the log actually fires before, not after, notifications complete. Additionally, if any sendNotification call rejects, the rejection is unhandled since forEach discards the returned promises, rather than being surfaced to the caller of notifyAllSubscribers.

</details>

### `correctness-01-off-by-one-pagination`

Summary: The paginate.ts file introduces a `getPage` function with an off-by-one bug: it slices one extra element beyond the intended page size.

Score: 0.92 (raw 0.5) · Passed: true · Hard failure: false
Latency: 7662 ms · Tokens: 3008 in / 688 out

| # | Category (raw → normalized) | Severity | Confidence | File:Line | Match method | Classification | Matched id |
|---|---|---|---|---|---|---|---|
| 0 | correctness.off-by-one | P0 | high | paginate.ts:7 | canonical_category_location | matched_required | req-1 |
| 1 | error-handling → error-handling.swallowed-exception | P2 | medium | paginate.ts:5-6 | canonical_category_location | matched_optional | opt-1 |

<details><summary>Raw evidence text per finding (verbatim, for auditing hallucination/fabrication classifications)</summary>

- **#0** (matched_required): In `getPage`, `end` is computed as `start + pageSize`, which is already the correct exclusive end index for [unverified quote removed]. However, the code calls `items.slice(start, end + 1)`, which extends the slice by one extra element. This means every page returned will contain [unverified quote removed] items instead of `pageSize` items, and the extra item will be duplicated as the first item of the next page's results when paginating sequentially.
- **#1** (matched_optional): The function does not validate that `pageNumber` is >= 1 or that `pageSize` is a positive number. If `pageNumber` is 0 or negative, or `pageSize` is 0 or negative, `start` and `end` can become negative or produce unexpected slice ranges, silently returning incorrect or empty results without any error.

</details>

### `correctness-02-safe-half-open-range`

Summary: The new ranges.ts file adds getRange and chunk helpers. getRange is documented and named to represent a strict half-open index range [startIndex, endIndexExclusive), but it directly delegates to Array.prototype.slice without any validation, so negative indices are silently reinterpreted as offsets from the end of the array (and NaN inputs are silently treated as 0) rather than being treated as literal range boundaries. This contradicts the function's own docstring/contract (and the PR's 'safe-half-open-range' framing), producing results that don't correspond to the documented semantics for inputs that are entirely plausible for a range-index API (negative or out-of-bound indices).

Score: 1.00 (raw 1) · Passed: true · Hard failure: false
Latency: 29406 ms · Tokens: 3179 in / 2693 out

No findings produced.

### `dead-code-01-unreachable-after-return`

Summary: The new status-color.ts file contains a console.log statement placed after both branches of the if/else already return, making it unreachable dead code that will never execute.

Score: 1.00 (raw 1) · Passed: true · Hard failure: false
Latency: 6142 ms · Tokens: 2998 in / 398 out

| # | Category (raw → normalized) | Severity | Confidence | File:Line | Match method | Classification | Matched id |
|---|---|---|---|---|---|---|---|
| 0 | dead-code.unreachable | P2 | high | status-color.ts:11 | canonical_category_location | matched_required | req-1 |

<details><summary>Raw evidence text per finding (verbatim, for auditing hallucination/fabrication classifications)</summary>

- **#0** (matched_required): In getStatusColor, both branches of the if/else return a value, so control flow can never reach the line after the if/else block. The `console.log(`resolved status color for ${status}`);` statement is unreachable dead code and will never execute, meaning any intended logging of the resolved status color never happens.

</details>

### `edge-case-api-misuse-01-reduce-no-initial-value`

Summary: The new totalReviewScore function uses Array.prototype.reduce without an initial value, which throws a TypeError when called with an empty array instead of returning 0.

Score: 1.00 (raw 1) · Passed: true · Hard failure: false
Latency: 5341 ms · Tokens: 2969 in / 470 out

| # | Category (raw → normalized) | Severity | Confidence | File:Line | Match method | Classification | Matched id |
|---|---|---|---|---|---|---|---|
| 0 | error-handling → error-handling.swallowed-exception | P1 | high | score.ts:5 | canonical_category_location | matched_required | req-1 |

<details><summary>Raw evidence text per finding (verbatim, for auditing hallucination/fabrication classifications)</summary>

- **#0** (matched_required): totalReviewScore calls `scores.reduce((sum, score) => sum + score)` without providing an initial accumulator value. If `scores` is an empty array (e.g., a pull request with no reviews yet), Array.prototype.reduce throws 'TypeError: Reduce of empty array with no initial value' instead of returning a sensible default like 0. This is a realistic edge case given the function's stated purpose of summing scores from every review on a PR, since a PR may have zero reviews.

</details>

### `error-handling-01-swallowed-exception-async`

Summary: The reindex function swallows all errors from fetching documents or bulk-upserting the search index, logging only a generic message and returning normally (a resolved Promise<void>). Callers cannot detect failure, and the actual error object/details are discarded.

Score: 1.00 (raw 1) · Passed: true · Hard failure: false
Latency: 6616 ms · Tokens: 3078 in / 503 out

| # | Category (raw → normalized) | Severity | Confidence | File:Line | Match method | Classification | Matched id |
|---|---|---|---|---|---|---|---|
| 0 | error-handling → error-handling.swallowed-exception | P1 | high | reindex.ts:10-12 | canonical_category_location | matched_required | req-1 |

<details><summary>Raw evidence text per finding (verbatim, for auditing hallucination/fabrication classifications)</summary>

- **#0** (matched_required): In `reindexSearchDocuments`, any error thrown by `fetchDocumentsForWorkspace` or `searchIndex.bulkUpsert` is caught and only logged via `console.log("reindex failed")`. The function then falls through and the returned promise resolves normally (function returns void), so callers have no way to know the reindex failed. The original error object is discarded entirely, losing stack trace and failure details, and no workspaceId context is included in the log, making failures hard to diagnose or retry.

</details>

### `maintainability-01-deep-nesting-duplication`

Summary: The new classifyOrder function is logically correct but implemented with deeply nested if/else branches that duplicate the total > 1000 check four times, producing an 8-branch decision tree that is hard to read, test, and extend.

Score: 1.00 (raw 1) · Passed: true · Hard failure: false
Latency: 5520 ms · Tokens: 3260 in / 430 out

| # | Category (raw → normalized) | Severity | Confidence | File:Line | Match method | Classification | Matched id |
|---|---|---|---|---|---|---|---|
| 0 | maintainability.duplication | P2 | high | classify-order.ts:11-39 | canonical_category_location | matched_required | req-1 |

<details><summary>Raw evidence text per finding (verbatim, for auditing hallucination/fabrication classifications)</summary>

- **#0** (matched_required): classifyOrder nests three levels of if/else (isPriority, country, total > 1000), repeating the `if (order.total > 1000) {` check and similar string-building logic in all four leaf branches. This duplication makes the function harder to maintain: adding a new country, priority tier, or threshold requires editing multiple near-identical blocks, increasing the risk of inconsistent updates and bugs.

</details>

### `performance-01-linear-scan-in-filter`

Summary: The new filterBlockedComments function performs an O(n*m) linear scan by calling Array.prototype.includes inside the filter callback for every comment, checking against the blockedUserIds array each time. For large comment lists or large blocked-user lists this becomes a significant performance bottleneck; converting blockedUserIds to a Set before filtering would reduce lookups to O(1) each, yielding overall O(n+m) complexity.

Score: 1.00 (raw 1) · Passed: true · Hard failure: false
Latency: 6214 ms · Tokens: 3029 in / 537 out

| # | Category (raw → normalized) | Severity | Confidence | File:Line | Match method | Classification | Matched id |
|---|---|---|---|---|---|---|---|
| 0 | performance.algorithmic-complexity | P2 | high | filter-blocked.ts:10 | canonical_category_location | matched_required | req-1 |

<details><summary>Raw evidence text per finding (verbatim, for auditing hallucination/fabrication classifications)</summary>

- **#0** (matched_required): filterBlockedComments filters comments by calling `!blockedUserIds.includes(comment.authorId)` for every comment. Array.prototype.includes performs a linear scan of blockedUserIds, so for n comments and m blocked users this results in O(n*m) time complexity. This will scale poorly as either the comment list or the blocked-user list grows.

</details>

### `refactor-trap-01-long-but-correct-switch`

Summary: The diff adds a single new file, status-label.ts, containing a type-safe, exhaustive switch statement over the closed ReviewStatus union. Every member of the union is explicitly handled, and TypeScript's exhaustiveness checking will correctly verify that all code paths return a value, so no default case is required or missing here. No correctness, error-handling, performance, or maintainability defects were found in this code as written.

Score: 1.00 (raw 1) · Passed: true · Hard failure: false
Latency: 7233 ms · Tokens: 3079 in / 475 out

No findings produced.

## Failure pattern summary

| Failure reason | Fixture count |
|---|---|
| false positive | 1 |
| overconfidence | 1 |
| severity inflation | 1 |

