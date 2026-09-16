# ShipSafe — Product Spec

## Positioning

**ShipSafe** — AI Release Gate for Engineering Teams.

Core promise: **"Know if your code is safe to ship."**

ShipSafe reviews a GitHub Pull Request before merge and determines release
readiness, the way a very good, very fast staff engineer would — without
being one more Slack ping away.

## Problem

Human review quality is inconsistent under deadline pressure. The bugs that
escape review are rarely style nits — they're concurrency bugs, missing
migration guards, silent breaking changes, and security gaps that require
holding the whole system in your head at once. Teams want a consistent,
opinionated second reviewer that never gets tired and never skips the
diff.

## What ShipSafe Detects

- Correctness bugs
- Security vulnerabilities (auth, injection, secrets, tenant isolation)
- Race conditions / concurrency issues
- Architecture problems (coupling, layering, scalability)
- Database migration risks (locking, destructive schema changes, data loss)
- Breaking changes (API contracts, public interfaces)
- Missing or weak tests
- Code-quality issues

## Severity Model

| Level | Meaning |
|-------|---------|
| **P0 — Critical** | Will break production, a security hole, or data loss. Blocks merge. |
| **P1 — High priority** | Serious risk; should be fixed before shipping in most cases. |
| **P2 — Improvement** | Worth doing, not release-blocking. |
| **Nit** | Minor, stylistic, or optional polish. |

## Release Verdict

Every review resolves to exactly one verdict:

- **APPROVE** — no P0/P1 findings, safe to ship.
- **APPROVE WITH MINOR FIXES** — only P2/Nit findings, or P1 findings the
  judge deems non-blocking.
- **DO NOT APPROVE** — one or more P0 findings, or a cluster of P1 findings
  that add up to unacceptable risk.

The verdict is produced by the **Release Judge**, which consolidates the
findings of every specialized reviewer — it does not just take the worst
individual finding, it reasons about the review as a whole.

## Long-Term Product Vision

1. User connects a GitHub account / installs the ShipSafe GitHub App.
2. ShipSafe receives a pull request (webhook).
3. Multiple specialized AI reviewers analyze the diff in parallel:
   - **Code Reviewer** — correctness, logic, edge cases
   - **Security Reviewer** — auth, permissions, secrets, injection, tenant isolation
   - **Architecture Reviewer** — coupling, scalability, maintainability
   - **Database Reviewer** — schema changes, migrations, locking, data integrity
   - **Test Reviewer** — missing tests, weak tests, race coverage
   - **Release Judge** — consolidates findings, produces the final verdict
4. Findings and the verdict are shown in the ShipSafe dashboard.
5. (Later) ShipSafe posts inline PR comments and a GitHub status check that
   can gate merge.
6. (Later) "Fix with AI" opens an automatic repair branch and re-runs
   review after the fix lands.

## MVP Scope (Phase 1)

Ship a real, usable product loop end-to-end using a **mock/demo PR**
before wiring up live GitHub integration:

1. Premium SaaS landing page
2. Authentication
3. Dashboard (list of repositories / reviews)
4. Repository connection architecture (data model + UI, GitHub App comes later)
5. Pull Request review screen
6. Review / finding data model
7. Multi-agent review architecture (6 reviewers, real orchestration logic)
8. Release-readiness verdict
9. A mock/demo PR review that exercises the entire pipeline end-to-end

The dashboard must show, per PR review:

- PR title / repository / branch
- Changed files
- Reviewers and their statuses (pending / running / complete / failed)
- Release verdict
- Counts of P0 / P1 / P2 / Nit findings
- Findings with file + line reference
- Test / build / security status
- Review summary

## Explicitly Out of Scope for MVP

- Real GitHub App / webhook ingestion
- Live LLM calls to review real, arbitrary PRs (the review *engine* is real;
  the MVP's data source is a curated demo PR, not a live GitHub fetch)
- "Fix with AI" / automatic repair branches
- GitHub status checks / merge gating
- Billing
- Team / org multi-tenancy beyond a single user owning their repos
