import { describe, expect, it } from "vitest";
import { validateSignUpCredentials } from "./sign-up-validation";

describe("validateSignUpCredentials", () => {
  it("accepts matching passwords and returns only email/password — never confirmPassword", () => {
    const result = validateSignUpCredentials({
      email: "new-user@example.com",
      password: "correct-horse-battery",
      confirmPassword: "correct-horse-battery",
    });

    expect(result).toEqual({
      ok: true,
      data: { email: "new-user@example.com", password: "correct-horse-battery" },
    });
    if (result.ok) {
      expect("confirmPassword" in result.data).toBe(false);
    }
  });

  it("rejects mismatched passwords with a clear, specific error", () => {
    const result = validateSignUpCredentials({
      email: "new-user@example.com",
      password: "correct-horse-battery",
      confirmPassword: "totally-different",
    });

    expect(result).toEqual({ ok: false, error: "Passwords do not match." });
  });

  it("rejects a missing confirm password with a clear, specific error", () => {
    const result = validateSignUpCredentials({
      email: "new-user@example.com",
      password: "correct-horse-battery",
      confirmPassword: null,
    });

    expect(result).toEqual({ ok: false, error: "Confirm your password." });
  });

  it("rejects an empty-string confirm password the same way as a missing one", () => {
    const result = validateSignUpCredentials({
      email: "new-user@example.com",
      password: "correct-horse-battery",
      confirmPassword: "",
    });

    expect(result).toEqual({ ok: false, error: "Confirm your password." });
  });

  it("still rejects an invalid email even when the passwords match", () => {
    const result = validateSignUpCredentials({
      email: "not-an-email",
      password: "correct-horse-battery",
      confirmPassword: "correct-horse-battery",
    });

    expect(result).toEqual({ ok: false, error: "Enter a valid email address." });
  });

  it("still rejects a too-short password even when it matches confirmPassword", () => {
    const result = validateSignUpCredentials({
      email: "new-user@example.com",
      password: "short1",
      confirmPassword: "short1",
    });

    expect(result).toEqual({ ok: false, error: "Password must be at least 8 characters." });
  });
});
