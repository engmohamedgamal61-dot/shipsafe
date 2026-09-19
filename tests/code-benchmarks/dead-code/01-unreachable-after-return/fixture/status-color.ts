/**
 * Returns the badge color for a two-state review status.
 */
export function getStatusColor(status: "open" | "closed"): string {
  if (status === "open") {
    return "green";
  } else {
    return "gray";
  }

  console.log(`resolved status color for ${status}`);
}
