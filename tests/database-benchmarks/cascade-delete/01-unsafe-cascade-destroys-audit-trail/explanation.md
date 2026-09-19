# cascade-delete-01-unsafe-cascade-destroys-audit-trail

`workspace_audit_log` declares its purpose in its own leading comment:
"for compliance review." A compliance audit log's core requirement is
that it survives the actor being removed — yet `actor_id` cascades on
delete from `public.profiles`, so deleting a user erases their entire
audit history.

The table has a SECOND `on delete cascade` (`workspace_id` →
`public.workspaces`). This fixture tests whether the reviewer can tell
the two apart from the table's stated purpose — a reviewer that flags
every `on delete cascade` indiscriminately, or the whole table instead
of a specific column, is pattern-matching, not reasoning.

**Updated after the first live baseline run:** the real reviewer argued
that workspace_id's cascade is ALSO questionable for a compliance log —
a defensible position (some compliance regimes require the audit trail
to outlive the audited entity entirely, e.g. to investigate a workspace
deletion itself). Rather than treat that as a wrong answer, it's now an
acceptable `optional_findings` entry: `req-1` (actor_id) remains the
one unambiguous, required defect no reasonable interpretation disputes;
`opt-1` (workspace_id) is a genuinely debatable secondary call that
should not be penalized as an overreach.
