# race-condition-01-missing-unique-constraint-duplicate-invite

`workspace_invitations` has no unique constraint on `(workspace_id,
email)`. Two concurrent "invite this person" requests — a double-click,
a retried request after a timeout, two admins acting at once — both read
"no existing invite," then both insert, and Postgres accepts both rows:
a duplicate-row race enabled entirely by a missing constraint, which is
exactly the "race-condition / uniqueness" archetype this fixture targets
(the two bullets are one root cause here, not two).

This is deliberately an OMISSION defect: there's no single wrong line to
point at, only a missing constraint that should exist alongside the
table's other columns — the ground truth's line range spans the whole
`create table` statement rather than one column, since that's genuinely
where a fix (adding the constraint) would land.
