# responsibility-separation-01-business-logic-in-server-action

`finalizeReview` is a Next.js Server Action — the controller-layer
boundary in this codebase's architecture, meant to be thin: authenticate,
delegate to the domain/application layer, shape a response. Instead it
directly encodes the verdict policy (which reviewers are required to be
complete, that any P0 finding blocks approval) inline.

This is a real, current architectural defect, not a style nitpick: the
policy now lives in two places (here, and wherever the domain's own
verdict logic lives), so a future change to the policy can silently
diverge between the two. `allowed_categories` accepts either a
"business-logic-leakage" or "duplication" framing since both are
correct descriptions of the same root cause.
