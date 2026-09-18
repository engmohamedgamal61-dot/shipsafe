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

export function VerdictPill({ verdict, status }: { verdict: Verdict | null; status?: RunStatus }) {
  if (!verdict) {
    const label = (status && IN_PROGRESS_LABEL[status]) ?? "Pending";
    return (
      <span className="inline-flex items-center rounded-full bg-surface-muted px-3 py-1 text-xs font-medium text-muted-foreground">
        {label}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold",
        CLASSES[verdict],
      )}
    >
      {VERDICT_LABEL[verdict]}
    </span>
  );
}
