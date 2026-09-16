import { redirect } from "next/navigation";
import { getAuth } from "@/server/container";
import type { Session } from "./types";

/** Server Component helper: redirects to sign-in when there's no active session. */
export async function requireSession(): Promise<Session> {
  const session = await getAuth().getSession();
  if (!session) {
    redirect("/sign-in");
  }
  return session;
}
