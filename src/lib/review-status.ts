import type { RunStatus } from "@/domain/types";

/**
 * A review still has work left to do — the only states worth polling for.
 *
 * Deliberately its own plain module, not exported from
 * `components/dashboard/auto-refresh.tsx`: that file has a top-level
 * `"use client"` directive, which marks EVERY export from it — not just
 * the `AutoRefresh` component — as client-boundary. A Server Component
 * calling a "use client" file's function export directly (rather than
 * rendering it as `<Component />` or passing it through as a prop) is a
 * runtime error: "Attempted to call X() from the server but X is on the
 * client." `dashboard/page.tsx` and the review detail page both need to
 * call this as a plain function to decide what to render, so it has to
 * live outside any "use client" boundary.
 */
export function isReviewInProgress(status: RunStatus): boolean {
  return status === "pending" || status === "running";
}
