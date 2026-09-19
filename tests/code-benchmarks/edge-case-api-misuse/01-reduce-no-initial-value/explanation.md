# edge-case-api-misuse-01-reduce-no-initial-value

`Array.prototype.reduce((sum, score) => sum + score)` — with no second
argument — throws `TypeError: Reduce of empty array with no initial
value` if `scores` is `[]`. The function's doc comment describes
summing "every review on a pull request," and a pull request can
legitimately have zero reviews (e.g. right after it's opened), so this
is a realistic, reachable crash, not a contrived one.

The fix (`scores.reduce((sum, score) => sum + score, 0)`) is a one-token
change; the point of the fixture is recognizing the missing initial
value as a real defect, which is both an "edge case not handled" and an
"API misused" framing of the same underlying mistake — either label is
accepted.
