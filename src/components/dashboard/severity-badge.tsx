import { SEVERITY_LABEL, type Severity } from "@/domain/types";
import { cn } from "@/lib/utils";

const CLASSES: Record<Severity, string> = {
  P0: "bg-severity-p0-bg text-severity-p0",
  P1: "bg-severity-p1-bg text-severity-p1",
  P2: "bg-severity-p2-bg text-severity-p2",
  NIT: "bg-severity-nit-bg text-severity-nit",
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold tracking-wide",
        CLASSES[severity],
      )}
    >
      {severity === "P0" || severity === "P1" ? severity : SEVERITY_LABEL[severity]}
    </span>
  );
}
