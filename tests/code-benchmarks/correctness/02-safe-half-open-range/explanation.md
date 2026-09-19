# correctness-02-safe-half-open-range

Both `getRange()` and `chunk()` use `slice()` correctly: `getRange` passes
its exclusive-end argument straight through, and `chunk` advances by
`size` and slices `[i, i + size)` each iteration, which is the textbook
correct chunking pattern.

This fixture is the false-positive-trap counterpart to
`correctness-01-off-by-one-pagination`, which has the same general
shape (`slice(x, x + something)`) but is genuinely broken (`end + 1`
instead of `end`). A reviewer that flags either function here on the
grounds that "slicing with an added offset is suspicious" — without
actually checking whether the offset makes the range correct or
incorrect — fails this fixture.

**Fixed after the first real baseline run (Phase 4 root-cause audit):**
the first authored version of `chunk()` had no guard on `size` — with
`size <= 0` or `size` being `NaN`, `i += size` never advances `i` past
`items.length`, hanging the loop forever. The Code Reviewer's baseline
run correctly identified this as a real defect; auditing it confirmed
the claim was genuinely true, not a false positive — this was a real
bug in the fixture's own "safe" code, not a benchmark/scorer issue or a
reviewer error. Per the benchmark's own root-cause discipline ("do not
assume the reviewer is wrong until the fixture is checked"), the fixture
was corrected (an explicit guard clause added) rather than the finding
being dismissed. `getRange()`'s lack of NaN validation was also flagged
by the same run, at `Nit`/`low` severity — left as-is, since silently
treating `NaN` as `0` is standard, expected `Array.prototype.slice`
behavior, not a defect worth demanding every thin wrapper guard against.
