# correctness-01-off-by-one-pagination

`getPage()` computes `start`/`end` correctly for a half-open `[start, end)`
range, then calls `items.slice(start, end + 1)` — `Array.prototype.slice`'s
second argument is already exclusive, so `end + 1` makes the call inclusive
of `end`, returning `pageSize + 1` items instead of `pageSize`, and
duplicating the item at index `end` across page N and page N + 1.

This is deliberately a "pure arithmetic" bug: no async behavior, no
external dependency, no security angle — verifiable by reading the
5-line function alone. It exists to test whether the Code Reviewer
catches a classic off-by-one in slicing/pagination logic, which is
exactly the kind of "correctness bug" a code reviewer (as opposed to a
security reviewer) exists to catch.

**`opt-1` added after the first real baseline run:** the reviewer also,
correctly, pointed out that `getPage` never validates `pageNumber`/`pageSize`
— a negative `start` (from `pageNumber <= 0`) is treated by
`Array.prototype.slice` as an offset from the end of the array, silently
returning confusing results instead of failing loudly. This is a real,
independent secondary observation (auditing it confirmed it's true, not
a false positive) that the original fixture's strict
`allowed_categories`/`prohibited_categories` unfairly penalized as a
prohibited finding — added as `optional_findings` per the same
"required vs. optional vs. prohibited" mechanism used throughout this
benchmark's design, rather than dismissing a genuinely correct
observation as noise.
