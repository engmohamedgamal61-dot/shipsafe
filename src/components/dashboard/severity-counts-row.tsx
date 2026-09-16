import { SEVERITIES, SEVERITY_LABEL, type SeverityCounts } from "@/domain/types";
import { cn } from "@/lib/utils";

const DOT_CLASSES = {
  P0: "bg-severity-p0",
  P1: "bg-severity-p1",
  P2: "bg-severity-p2",
  NIT: "bg-severity-nit",
} as const;

export function SeverityCountsRow({ counts }: { counts: SeverityCounts }) {
  return (
    <div className="flex flex-wrap items-center gap-4">
      {SEVERITIES.map((severity) => (
        <div key={severity} className="flex items-center gap-1.5 text-sm">
          <span className={cn("h-2 w-2 rounded-full", DOT_CLASSES[severity])} />
          <span className="font-semibold">{counts[severity]}</span>
          <span className="text-muted-foreground">{SEVERITY_LABEL[severity]}</span>
        </div>
      ))}
    </div>
  );
}
