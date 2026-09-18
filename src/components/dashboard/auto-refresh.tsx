"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const POLL_INTERVAL_MS = 4000;

/**
 * Renders nothing. While `active`, schedules exactly one
 * `router.refresh()` (re-runs the Server Component tree, fetching fresh
 * data — see Next.js `useRouter` docs) after `POLL_INTERVAL_MS`, and only
 * that one. Polling "stopping on its own" once a review reaches a
 * terminal state isn't a separate step to get right — the parent Server
 * Component re-renders with the fresh `active` value after every refresh,
 * this effect re-runs with it, and once `active` is false the effect
 * simply doesn't re-arm the timer. There's nothing left running to leak.
 */
export function AutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => router.refresh(), POLL_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [active, router]);

  return null;
}
