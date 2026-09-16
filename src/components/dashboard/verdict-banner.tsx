import { CheckCircle2, ShieldAlert, XCircle } from "lucide-react";
import { VERDICT_LABEL, type Verdict } from "@/domain/types";
import { cn } from "@/lib/utils";

const STYLES: Record<Verdict, { classes: string; icon: typeof CheckCircle2 }> = {
  APPROVE: { classes: "bg-verdict-approve-bg text-verdict-approve", icon: CheckCircle2 },
  APPROVE_WITH_MINOR_FIXES: {
    classes: "bg-verdict-minor-bg text-verdict-minor",
    icon: ShieldAlert,
  },
  DO_NOT_APPROVE: { classes: "bg-verdict-block-bg text-verdict-block", icon: XCircle },
};

export function VerdictBanner({
  verdict,
  summary,
}: {
  verdict: Verdict;
  summary: string;
}) {
  const { classes, icon: Icon } = STYLES[verdict];

  return (
    <div className={cn("flex items-start gap-3 rounded-xl border border-border p-5", classes)}>
      <Icon className="mt-0.5 h-6 w-6 shrink-0" aria-hidden />
      <div className="flex flex-col gap-1">
        <span className="text-lg font-semibold">{VERDICT_LABEL[verdict]}</span>
        <p className="text-sm opacity-90">{summary}</p>
      </div>
    </div>
  );
}
