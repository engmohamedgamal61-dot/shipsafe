import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { AuthPort, Session } from "./types";

/** Real auth backed by Supabase, active whenever `isSupabaseConfigured` is true. */
export class SupabaseAuthAdapter implements AuthPort {
  async getSession(): Promise<Session | null> {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user || !user.email) return null;
    return { userId: user.id, email: user.email, isDemo: false };
  }

  async signOut(): Promise<void> {
    const supabase = await createServerSupabaseClient();
    await supabase.auth.signOut();
  }
}
