# safe-migration-01-scoped-uniqueness-and-correct-cascades

Deliberately reuses the exact same SHAPES as this benchmark's buggy
fixtures, with the defect fixed in each case, to test whether the
reviewer is reasoning about the specific table's semantics or just
pattern-matching on surface features:

- `workspace_id ... on delete cascade` — correct here (contrast with
  `cascade-delete-01`'s wrong `actor_id` cascade on an audit log).
- `created_by ... on delete restrict` — correct: preserves the key (and
  who issued it) even if that user is later removed, the opposite
  lesson from the same fixture.
- `unique (workspace_id, name)` — correct, tenant-scoped uniqueness. A
  reviewer demanding a bare `unique (name)` would be WRONG: two
  different workspaces both naming a key "ci-deploy" is completely fine
  and expected, not a defect. This is the fixture's answer to "RLS /
  tenant-isolation concerns ONLY when database-layer" — a per-tenant
  unique constraint done correctly.
- `key_hash` gets its own global unique index — correct, since a hash
  must be a reliable, collision-free lookup key across all workspaces,
  unlike `name`.

Zero findings expected. A reviewer that flags any of the above because
it superficially resembles one of this benchmark's buggy fixtures fails
this test.
