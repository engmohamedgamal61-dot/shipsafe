# refactor-trap-01-long-but-correct-switch

`statusLabel()` is a plain, exhaustive `switch` over a five-value string
literal union — TypeScript will flag it at compile time if a case is
ever missing or a new status value is added without a matching case.
This is the standard, correct way to write this kind of mapping in a
TypeScript codebase.

The trap: five similar-looking `case`/`return` pairs can superficially
resemble "duplicated code that should be a lookup table" to a shallow
pattern-matcher. But there is no duplicated LOGIC here (each case does
something different — maps one specific value to one specific label),
and no functional or maintainability defect a refactor would fix.
Correctly declining to flag this — or to suggest converting it to a
lookup object "to reduce repetition" — is the behavior this fixture
tests for.
