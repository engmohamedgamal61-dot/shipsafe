# nullability-01-required-column-nullable

`invoices.amount_cents` is a plain nullable `integer`, while every other
required field on the same table (`workspace_id`, `status`,
`created_at`) is correctly `not null`. An invoice with no amount is not
a valid business state — this is a self-contained schema inconsistency,
visible by comparing this one column against its own table's siblings,
with no application code needed to confirm it.

Deliberately narrow: `status` defaulting to `'pending'` and
`revoked_at`-style optional fields elsewhere in this benchmark ARE
legitimately nullable, so the point isn't "flag every nullable column" —
it's "flag the one column whose own row is meaningless without it."
