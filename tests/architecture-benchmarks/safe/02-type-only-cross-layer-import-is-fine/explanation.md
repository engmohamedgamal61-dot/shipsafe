# safe-02-type-only-cross-layer-import-is-fine

`ReviewList` (a UI component) imports `ReviewWithContext` — a TYPE, via
`import type` — from the domain layer. This is the correct, expected
direction: UI/outer layers depend on domain/inner-layer type
definitions for type safety; the domain never depends back on the UI.

Contrast with `layer-boundaries-01` (a repository importing a UI VALUE
and calling it) — that is a genuine violation because it's (a) the
wrong direction (inner layer depending on outer layer) and (b) a value
import with runtime behavior, not a type. This fixture isolates just
the "type-only, correct-direction" case as a false-positive trap: a
reviewer that treats ALL cross-layer references as suspect, without
checking direction or type-vs-value, will incorrectly flag this.
