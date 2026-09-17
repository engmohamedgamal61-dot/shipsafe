import { AlertTriangle } from "lucide-react";

/**
 * Rendered whenever a review's diff or changed-file list exceeded the
 * ingest limits (`src/server/github/pr-hardening.ts`) and was cut before
 * review — so the dashboard never presents a partial review as if it
 * covered the whole pull request.
 */
export function TruncationNotice({
  diffTruncated,
  changedFilesTruncated,
}: {
  diffTruncated: boolean;
  changedFilesTruncated: boolean;
}) {
  if (!diffTruncated && !changedFilesTruncated) return null;

  return (
    <div className="flex items-start gap-3 rounded-xl border border-severity-p1 bg-severity-p1-bg p-4 text-sm">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-severity-p1" aria-hidden />
      <p>
        This pull request exceeded ShipSafe&apos;s ingest limits, so this review only covers a{" "}
        {diffTruncated && changedFilesTruncated
          ? "truncated diff and a partial changed-file list"
          : diffTruncated
            ? "truncated diff"
            : "partial changed-file list"}
        . Treat findings below as incomplete, not a full review of this PR.
      </p>
    </div>
  );
}
