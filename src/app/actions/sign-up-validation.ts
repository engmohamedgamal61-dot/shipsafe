import { z } from "zod";

const signUpSchema = z
  .object({
    email: z.string().email("Enter a valid email address."),
    password: z.string().min(8, "Password must be at least 8 characters."),
    confirmPassword: z.string().min(1, "Confirm your password."),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export type SignUpValidation =
  | { ok: true; data: { email: string; password: string } }
  | { ok: false; error: string };

/**
 * Pure (no FormData/Supabase/redirect) so the matching/mismatched/missing
 * cases are directly unit-testable — see sign-up-validation.test.ts. Only
 * ever returns `{ email, password }`: `confirmPassword` exists purely to
 * be checked against `password` here and is never part of the returned
 * data, so it can't leak into `supabase.auth.signUp()`.
 *
 * Deliberately its own module, not exported alongside the Server Actions
 * in `sign-in.ts`: that file has a top-level `"use server"` directive,
 * which requires every one of its exports to be an async Server Action —
 * a plain synchronous function like this one fails the build
 * ("Server Actions must be async functions") if it lives there.
 */
export function validateSignUpCredentials(input: {
  email: FormDataEntryValue | null;
  password: FormDataEntryValue | null;
  confirmPassword: FormDataEntryValue | null;
}): SignUpValidation {
  // A field missing from FormData entirely comes through as `null`, not
  // `""` — normalize it so "missing" and "present but empty" both hit the
  // same `.min(1, "Confirm your password.")` message instead of `null`
  // failing Zod's base `z.string()` type check with a generic error.
  const parsed = signUpSchema.safeParse({
    email: input.email ?? "",
    password: input.password ?? "",
    confirmPassword: input.confirmPassword ?? "",
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Enter a valid email and password." };
  }
  return { ok: true, data: { email: parsed.data.email, password: parsed.data.password } };
}
