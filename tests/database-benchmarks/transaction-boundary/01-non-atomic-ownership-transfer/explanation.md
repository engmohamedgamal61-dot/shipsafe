# transaction-boundary-01-non-atomic-ownership-transfer

`transferWorkspaceOwnership` demotes the old owner and promotes the new
one as two separate, sequential `.update()` calls with no shared
transaction. If the second call fails after the first succeeds — a
dropped connection, a transient error, a process crash — the workspace
ends up with zero owners, a state the rest of this codebase's RLS
policies (see `supabase/migrations/0001_init.sql`'s `is_workspace_owner`
helper) assume can never happen.

The fix is a single Postgres function called via RPC (or an explicit
transaction), matching the pattern this codebase already uses elsewhere
for atomic multi-row writes (e.g. `handle_new_workspace`'s trigger).
