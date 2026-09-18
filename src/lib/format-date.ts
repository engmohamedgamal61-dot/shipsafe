/**
 * Formats an ISO timestamp as e.g. "Sep 18, 2026 at 10:42 AM".
 *
 * Deliberately takes no `timeZone` by default — `Intl.DateTimeFormat`
 * then uses whatever timezone the JS runtime it executes in is set to.
 * Called from a client component (see `components/dashboard/local-date-time.tsx`)
 * so that runtime is the visitor's own browser, not the Next.js server.
 * `options` exists only so tests can pin a deterministic locale/timezone.
 */
export function formatDateTime(
  iso: string,
  options?: { locale?: string; timeZone?: string },
): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }

  const datePart = new Intl.DateTimeFormat(options?.locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: options?.timeZone,
  }).format(date);

  const timePart = new Intl.DateTimeFormat(options?.locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: options?.timeZone,
  }).format(date);

  return `${datePart} at ${timePart}`;
}
