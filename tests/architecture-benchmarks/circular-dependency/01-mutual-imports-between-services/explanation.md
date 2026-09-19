# circular-dependency-01-mutual-imports-between-services

`ingest.ts` (real GitHub PR ingestion) imports `recordReviewCompletion`
from `seed.ts` (demo-mode seeding), and `seed.ts` imports
`ingestPullRequest` back from `ingest.ts`. Neither module has a
legitimate reason to depend on the other — demo seeding is explicitly a
separate, deterministic path (see `src/server/demo/seed.ts`'s real
purpose) that should never call into real ingestion, and vice versa.

This is a genuine, two-hop, directly-evidenced cycle — not a deep,
speculative dependency graph the reviewer would have to infer. Ground
truth accepts a finding anchored to either file's import line as the
same single root cause; two separate findings (one per file) should
collapse to one, testing the "one root cause, one finding" principle
specifically for circular-import detection.
