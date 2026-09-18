import { VERDICT_LABEL, type RunStatus, type Verdict } from "@/domain/types";
import { cn } from "@/lib/utils";

const CLASSES: Record<Verdict, string> = {
  APPROVE: "bg-verdict-approve-bg text-verdict-approve",
  APPROVE_WITH_MINOR_FIXES: "bg-verdict-minor-bg text-verdict-minor",
  DO_NOT_APPROVE: "bg-verdict-block-bg text-verdict-block",
};

/**
 * A review with no verdict yet is either still queued or actively being
 * reviewed — distinguishing the two (rather than one generic "Pending"
 * label) is what keeps a queued PR from looking like it's simply missing
 * while the async AI pipeline works through it. `status` is optional so
 * existing callers that only have a verdict keep working unchanged.
 */
const IN_PROGRESS_LABEL: Partial<Record<RunStatus, string>> = {
  pending: "Queued",
  running: "Analyzing…",
};

export type VerdictPillContent =
  | { kind: "failed"; label: string }
  | { kind: "in-progress"; label: string }
  | { kind: "verdict"; label: string; verdict: Verdict };

/**
 * Pure decision logic behind `VerdictPill`, split out so the
 * queued/running/complete/failed cases are each directly unit-testable
 * without a component-rendering harness (this project has none — see
 * verdict-pill.test.ts).
 */
export function pillContentFor(verdict: Verdict | null, status?: RunStatus): VerdictPillContent {
  // A `failed` review always carries verdict DO_NOT_APPROVE (the
  // fail-closed default — see ReviewOrchestrator.run()), but that's a
  // different situation from a review that completed and genuinely
  // concluded DO_NOT_APPROVE: one is an infrastructure failure with no
  // trustworthy verdict, the other is a real AI-reviewed rejection.
  // Surfacing them identically would hide that distinction from the
  // tester, so `failed` is checked first and shown on its own.
  if (status === "failed") {
    return { kind: "failed", label: "Failed" };
  }

  if (!verdict) {
    return { kind: "in-progress", label: (status && IN_PROGRESS_LABEL[status]) ?? "Pending" };
  }

  return { kind: "verdict", label: VERDICT_LABEL[verdict], verdict };
}

export function VerdictPill({ verdict, status }: { verdict: Verdict | null; status?: RunStatus }) {
  const content = pillContentFor(verdict, status);

  if (content.kind === "failed") {
    return (
      <span className="inline-flex items-center rounded-full bg-verdict-block-bg px-3 py-1 text-xs font-semibold text-verdict-block">
        {content.label}
      </span>
    );
  }

  if (content.kind === "in-progress") {
    return (
      <span className="inline-flex items-center rounded-full bg-surface-muted px-3 py-1 text-xs font-medium text-muted-foreground">
        {content.label}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold",
        CLASSES[content.verdict],
      )}
    >
      {content.label}
    </span>
  );
}
