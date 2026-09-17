import { describe, expect, it, vi } from "vitest";
import { signInstallState, verifyInstallState } from "./install-state";

describe("install-state round trip", () => {
  it("verifies a freshly signed token and recovers the original payload", () => {
    const token = signInstallState("workspace-1", "user-1");
    const result = verifyInstallState(token);
    expect(result).toEqual({ workspaceId: "workspace-1", userId: "user-1" });
  });

  it("produces a different token each time (nonce) even for the same inputs", () => {
    const a = signInstallState("workspace-1", "user-1");
    const b = signInstallState("workspace-1", "user-1");
    expect(a).not.toBe(b);
  });

  it("rejects a tampered payload", () => {
    const token = signInstallState("workspace-1", "user-1");
    const [encoded, signature] = token.split(".");
    const forgedPayload = Buffer.from(
      JSON.stringify({ workspaceId: "someone-elses-workspace", userId: "user-1", nonce: "x", issuedAt: Date.now() }),
    ).toString("base64url");
    const forgedToken = `${forgedPayload}.${signature}`;
    expect(verifyInstallState(forgedToken)).toBeNull();
    void encoded;
  });

  it("rejects a malformed token without throwing", () => {
    expect(() => verifyInstallState("not-a-real-token")).not.toThrow();
    expect(verifyInstallState("not-a-real-token")).toBeNull();
    expect(verifyInstallState("")).toBeNull();
  });

  it("rejects an expired token", () => {
    const realNow = Date.now();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(realNow);
    const token = signInstallState("workspace-1", "user-1");

    nowSpy.mockReturnValue(realNow + 11 * 60 * 1000); // 11 minutes later — past the 10 minute TTL
    expect(verifyInstallState(token)).toBeNull();

    nowSpy.mockRestore();
  });
});
