import { VERDICT_LABEL, type Verdict } from "@/domain/types";
import { cn } from "@/lib/utils";

const CLASSES: Record<Verdict, string> = {
  APPROVE: "bg-verdict-approve-bg text-verdict-approve",
  APPROVE_WITH_MINOR_FIXES: "bg-verdict-minor-bg text-verdict-minor",
  DO_NOT_APPROVE: "bg-verdict-block-bg text-verdict-block",
};

export function VerdictPill({ verdict }: { verdict: Verdict | null }) {
  if (!verdict) {
    return (
      <span className="inline-flex items-center rounded-full bg-surface-muted px-3 py-1 text-xs font-medium text-muted-foreground">
        Pending
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
