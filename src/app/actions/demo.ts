"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/env";
import {
  DEMO_SESSION_COOKIE,
  buildDemoSessionCookieValue,
} from "@/server/auth/demo-adapter";

/**
 * Starts a demo session and redirects to the dashboard. Only meaningful
 * when Supabase isn't configured — in configured mode, real sign-up/sign-in
 * is used instead (see `/sign-in`).
 */
export async function startDemoSession() {
  if (isSupabaseConfigured) {
    redirect("/sign-in");
  }

  const cookieStore = await cookies();
  cookieStore.set(DEMO_SESSION_COOKIE, buildDemoSessionCookieValue(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });

  redirect("/dashboard");
}
