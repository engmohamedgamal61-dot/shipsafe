export function validateSignUpPassword(password: string, confirmPassword: string): { ok: true } | { ok: false; message: string } {
  if (password !== confirmPassword) {
    return { ok: false, message: "Passwords must match exactly." };
  }
  return { ok: true };
}
