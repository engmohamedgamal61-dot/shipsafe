import { CheckCircle2, CircleDashed, Loader2, XCircle } from "lucide-react";
import { REVIEWER_LABEL, type ReviewerRun, type RunStatus } from "@/domain/types";
import { countBySeverity } from "@/domain/types";
import { cn } from "@/lib/utils";

const STATUS_ICON: Record<RunStatus, typeof CheckCircle2> = {
  pending: CircleDashed,
  running: Loader2,
  complete: CheckCircle2,
  failed: XCircle,
};

const STATUS_CLASSES: Record<RunStatus, string> = {
  pending: "text-muted-foreground",
  running: "text-severity-p2 animate-spin",
  complete: "text-verdict-approve",
  failed: "text-verdict-block",
};

export function ReviewerStatusList({ runs }: { runs: ReviewerRun[] }) {
  const specialistRuns = runs.filter((run) => run.reviewer !== "judge");

  return (
    <ul className="flex flex-col divide-y divide-border">
      {specialistRuns.map((run) => {
        const Icon = STATUS_ICON[run.status];
        const counts = countBySeverity(run.findings);
        const total = run.findings.length;

        return (
          <li key={run.id} className="flex items-start gap-3 py-3">
            <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", STATUS_CLASSES[run.status])} aria-hidden />
            <div className="flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{REVIEWER_LABEL[run.reviewer]}</span>
                <span className="text-xs text-muted-foreground">
                  {total === 0 ? "No findings" : `${total} finding${total === 1 ? "" : "s"}`}
                </span>
              </div>
              {run.summary && (
                <p className="mt-0.5 text-sm text-muted-foreground">{run.summary}</p>
              )}
              {run.providerMetadata && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {run.providerMetadata.provider} · {run.providerMetadata.model} ·{" "}
                  {(run.providerMetadata.latencyMs / 1000).toFixed(1)}s
                </p>
              )}
              {total > 0 && (
                <div className="mt-1.5 flex gap-3 text-xs text-muted-foreground">
                  {counts.P0 > 0 && <span className="text-severity-p0 font-medium">{counts.P0} P0</span>}
                  {counts.P1 > 0 && <span className="text-severity-p1 font-medium">{counts.P1} P1</span>}
                  {counts.P2 > 0 && <span>{counts.P2} P2</span>}
                  {counts.NIT > 0 && <span>{counts.NIT} Nit{counts.NIT === 1 ? "" : "s"}</span>}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
