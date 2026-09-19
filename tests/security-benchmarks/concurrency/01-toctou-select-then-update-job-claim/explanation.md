# concurrency-01-toctou-select-then-update-job-claim

**What this tests:** whether the reviewer catches a classic
select-then-update race — the code "looks fine" read top to bottom (it
does check `status === "pending"` before claiming), but the check and
the write are two separate round trips with no compare-and-swap
condition tying them together.

**Why it's shaped this way:** deliberately modeled on ShipSafe's own,
*correct* `claimNextPendingReview()` in `src/server/github/writes.ts`,
with the one load-bearing line removed: the real function re-applies
the eligibility filter (`.or(eligibleFilter)`) inside the `UPDATE`'s
`WHERE` clause, so a losing racer's update simply matches zero rows and
returns `null`. This fixture's `UPDATE` is keyed on `id` alone, so both
racers' updates succeed.

**What would make this fixture wrong:** if the update included
`.eq("status", "pending")` (or used a single atomic
`UPDATE ... WHERE id = ? AND status = 'pending' RETURNING id`-style
statement), the race would be closed and this would become a `safe`
fixture instead.
