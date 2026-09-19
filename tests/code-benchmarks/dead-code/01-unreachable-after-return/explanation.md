# dead-code-01-unreachable-after-return

Both arms of the `if (status === "open") { ... } else { ... }` return a
value unconditionally, so control flow can never reach the
`console.log` statement that follows the block, regardless of what
`status` is. There's no loop, no async re-entry, no exception path that
could bring execution back to that line — it's simply unreachable.

Kept deliberately simple (a two-branch if/else, both returning) so
there's no ambiguity about whether the code is really unreachable — the
point of this fixture is to test detection of dead code specifically,
not to test control-flow reasoning under harder conditions (loops,
early continues, etc.), which would conflate two different skills.
