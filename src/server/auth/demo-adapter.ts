import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import type { AuthPort, Session } from "./types";

export const DEMO_SESSION_COOKIE = "shipsafe_demo_session";
export const DEMO_USER_ID = "00000000-0000-0000-0000-000000000001";
export const DEMO_USER_EMAIL = "demo@shipsafe.dev";
/** The demo user's single personal workspace. See src/server/demo/seed.ts. */
export const DEMO_WORKSPACE_ID = "00000000-0000-0000-0000-000000000002";

function sign(value: string): string {
  return createHmac("sha256", env.DEMO_SESSION_SECRET).update(value).digest("hex");
}

/** Value stored in the demo session cookie: `<userId>.<hmac>`. */
export function buildDemoSessionCookieValue(): string {
  return `${DEMO_USER_ID}.${sign(DEMO_USER_ID)}`;
}

function verify(cookieValue: string): boolean {
  const [userId, signature] = cookieValue.split(".");
  if (!userId || !signature) return false;
  const expected = sign(userId);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) && userId === DEMO_USER_ID;
}

/**
 * Demo-mode auth: a single seeded user, entered via a signed httpOnly
 * cookie set by the "View Live Demo" server action rather than a
 * password. See docs/ARCHITECTURE.md § Auth.
 */
export class DemoAuthAdapter implements AuthPort {
  async getSession(): Promise<Session | null> {
    const cookieStore = await cookies();
    const value = cookieStore.get(DEMO_SESSION_COOKIE)?.value;
    if (!value || !verify(value)) return null;
    return { userId: DEMO_USER_ID, email: DEMO_USER_EMAIL, isDemo: true };
  }

  async signOut(): Promise<void> {
    const cookieStore = await cookies();
    cookieStore.delete(DEMO_SESSION_COOKIE);
  }
}
