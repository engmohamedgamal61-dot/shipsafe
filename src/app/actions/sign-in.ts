"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { ok, err, type ActionResult } from "@/lib/errors";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export async function signInWithPassword(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return err("Enter a valid email and password (min 8 characters).");
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    return err(error.message);
  }

  redirect("/dashboard");
  return ok(null);
}

export async function signUpWithPassword(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return err("Enter a valid email and password (min 8 characters).");
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signUp(parsed.data);
  if (error) {
    return err(error.message);
  }

  redirect("/dashboard");
  return ok(null);
}
