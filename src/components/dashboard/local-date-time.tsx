"use client";

import { useSyncExternalStore } from "react";
import { formatDateTime } from "@/lib/format-date";

const noopSubscribe = () => () => {};

/**
 * Renders `${prefix} ${formatted date}` in the viewer's own browser
 * timezone — e.g. "Opened Sep 18, 2026 at 10:42 AM". `useSyncExternalStore`
 * with a server snapshot of `false` is the SSR-safe way to say "only
 * render this after we know we're on the client": both the server render
 * and React's first client render (which must match it, for hydration)
 * see `false` and render nothing, then React re-renders with the real
 * `true` client snapshot right after hydration — no effect, no
 * setState-in-effect, no server/client text mismatch.
 */
export function LocalDateTime({ prefix, iso }: { prefix: string; iso: string }) {
  const isClient = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );

  if (!isClient) return null;

  return (
    <span>
      {prefix} {formatDateTime(iso)}
    </span>
  );
}
