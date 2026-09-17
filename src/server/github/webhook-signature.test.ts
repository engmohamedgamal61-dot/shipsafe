import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyGithubSignature } from "./webhook-signature";

const SECRET = "test-webhook-secret";

function sign(body: string, secret = SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

describe("verifyGithubSignature", () => {
  it("accepts a correctly signed body", () => {
    const body = JSON.stringify({ action: "opened" });
    expect(verifyGithubSignature(body, sign(body), SECRET)).toBe(true);
  });

  it("rejects a body signed with a different secret", () => {
    const body = JSON.stringify({ action: "opened" });
    expect(verifyGithubSignature(body, sign(body, "wrong-secret"), SECRET)).toBe(false);
  });

  it("rejects when the body has been tampered with after signing", () => {
    const original = JSON.stringify({ action: "opened" });
    const signature = sign(original);
    const tampered = JSON.stringify({ action: "closed" });
    expect(verifyGithubSignature(tampered, signature, SECRET)).toBe(false);
  });

  it("rejects a missing signature header", () => {
    const body = JSON.stringify({ action: "opened" });
    expect(verifyGithubSignature(body, null, SECRET)).toBe(false);
  });

  it("rejects a malformed/short signature header without throwing", () => {
    const body = JSON.stringify({ action: "opened" });
    expect(() => verifyGithubSignature(body, "not-a-real-signature", SECRET)).not.toThrow();
    expect(verifyGithubSignature(body, "not-a-real-signature", SECRET)).toBe(false);
  });

  it("rejects an empty signature header", () => {
    const body = JSON.stringify({ action: "opened" });
    expect(verifyGithubSignature(body, "", SECRET)).toBe(false);
  });
});
