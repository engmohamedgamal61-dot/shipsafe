import { REVIEWER_LABEL, type Finding, type ReviewerKind } from "@/domain/types";
import { SeverityBadge } from "./severity-badge";

export interface FindingWithReviewer extends Finding {
  reviewer: ReviewerKind;
}

const SEVERITY_ORDER: Record<Finding["severity"], number> = { P0: 0, P1: 1, P2: 2, NIT: 3 };

export function FindingList({ findings }: { findings: FindingWithReviewer[] }) {
  if (findings.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        No findings. Every reviewer came back clean.
      </p>
    );
  }

  const sorted = [...findings].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );

  return (
    <ul className="flex flex-col gap-3">
      {sorted.map((finding) => (
        <li key={finding.id} className="rounded-lg border border-border p-4">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={finding.severity} />
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {REVIEWER_LABEL[finding.reviewer]}
            </span>
            <span className="text-xs text-muted-foreground">· {finding.category}</span>
          </div>
          <h4 className="mt-2 font-semibold">{finding.title}</h4>
          <p className="mt-1 text-sm text-muted-foreground">{finding.description}</p>
          {finding.filePath && (
            <p className="mt-2 font-mono text-xs text-muted-foreground">
              {finding.filePath}
              {finding.lineStart ? `:${finding.lineStart}` : ""}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
