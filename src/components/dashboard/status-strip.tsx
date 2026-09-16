import { CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import type { ReviewerRun } from "@/domain/types";
import { cn } from "@/lib/utils";

type StatusLevel = "pass" | "attention" | "fail";

const LEVEL_STYLES: Record<StatusLevel, { classes: string; icon: typeof CheckCircle2; label: string }> = {
  pass: { classes: "text-verdict-approve", icon: CheckCircle2, label: "Passing" },
  attention: { classes: "text-verdict-minor", icon: AlertTriangle, label: "Attention needed" },
  fail: { classes: "text-verdict-block", icon: XCircle, label: "Failing" },
};

function levelFor(run: ReviewerRun | undefined): StatusLevel {
  if (!run || run.status === "failed") return "fail";
  if (run.findings.some((f) => f.severity === "P0")) return "fail";
  if (run.findings.some((f) => f.severity === "P1")) return "attention";
  return "pass";
}

/**
 * "Build" has no real CI signal in the MVP (no live GitHub integration
 * yet) — it's a proxy for "did every reviewer run complete", which is
 * the honest thing to report until Phase 2 wires up real CI status.
 */
function buildLevelFor(runs: ReviewerRun[]): StatusLevel {
  return runs.some((r) => r.status === "failed") ? "fail" : "pass";
}

export function StatusStrip({ reviewerRuns }: { reviewerRuns: ReviewerRun[] }) {
  const security = reviewerRuns.find((r) => r.reviewer === "security");
  const test = reviewerRuns.find((r) => r.reviewer === "test");

  const items = [
    { label: "Security", level: levelFor(security) },
    { label: "Tests", level: levelFor(test) },
    { label: "Build", level: buildLevelFor(reviewerRuns) },
  ];

  return (
    <div className="flex flex-wrap gap-4">
      {items.map(({ label, level }) => {
        const { classes, icon: Icon, label: statusLabel } = LEVEL_STYLES[level];
        return (
          <div
            key={label}
            className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2"
          >
            <Icon className={cn("h-4 w-4", classes)} aria-hidden />
            <span className="text-sm font-medium">{label}</span>
            <span className={cn("text-xs", classes)}>{statusLabel}</span>
          </div>
        );
      })}
    </div>
  );
}
