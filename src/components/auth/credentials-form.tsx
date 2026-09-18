"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/errors";
import { Button } from "@/components/ui/button";

const INPUT_CLASSES =
  "h-10 rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:ring-2 focus:ring-brand";

export function CredentialsForm({
  action,
  submitLabel,
  requireConfirmPassword = false,
}: {
  action: (
    prev: ActionResult<null> | null,
    formData: FormData,
  ) => Promise<ActionResult<null>>;
  submitLabel: string;
  /** Adds a required "Confirm password" field — the sign-up form only; sign-in doesn't need it. */
  requireConfirmPassword?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  // Sign-up wants the browser/password-manager to treat this as a new
  // credential to generate/save, not autofill an existing login with.
  const passwordAutoComplete = requireConfirmPassword ? "new-password" : "current-password";

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className={INPUT_CLASSES}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete={passwordAutoComplete}
          className={INPUT_CLASSES}
        />
      </div>
      {requireConfirmPassword && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="confirmPassword" className="text-sm font-medium">
            Confirm password
          </label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className={INPUT_CLASSES}
          />
        </div>
      )}
      {state && !state.ok && (
        <p className="text-sm text-severity-p0">{state.error}</p>
      )}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Please wait…" : submitLabel}
      </Button>
    </form>
  );
}
