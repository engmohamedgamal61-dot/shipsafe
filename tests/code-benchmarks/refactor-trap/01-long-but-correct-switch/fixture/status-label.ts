export type ReviewStatus = "pending" | "running" | "complete" | "failed" | "cancelled";

/**
 * Maps a review status to its display label.
 */
export function statusLabel(status: ReviewStatus): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "running":
      return "Running";
    case "complete":
      return "Complete";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
  }
}
