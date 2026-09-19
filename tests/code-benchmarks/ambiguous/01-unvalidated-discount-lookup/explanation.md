# ambiguous-01-unvalidated-discount-lookup

`applyDiscountCode()` subtracts `lookupDiscount(code)` from `cart.total`
with no check that the result is a valid, bounded number. Whether this
is actually a bug depends entirely on `lookupDiscount`'s own contract —
does it always return a validated, bounded discount, or could it return
`undefined`/`NaN` for an unrecognized code, or a value larger than
`cart.total`? None of that is visible in this fixture; `lookupDiscount`
is imported, not defined here.

This is the ambiguous-fixture pattern: a plausible defect shape whose
confirmation depends on code that genuinely isn't included. Correct
behavior is to either say nothing, explicitly flag the missing context,
or report it as a low-confidence, non-required observation — never as a
confident, high-severity defect.
