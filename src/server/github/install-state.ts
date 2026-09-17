import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Short-lived, signed "state" token round-tripped through GitHub's App
 * installation flow: we redirect the browser to
 * `https://github.com/apps/<slug>/installations/new?state=<this>`, GitHub
 * echoes it back unmodified to our Setup URL once the user finishes
 * installing, and we use it to recover which workspace/user initiated
 * the install — GitHub has no other way to tell us that.
 *
 * Signed (not just base64) so a client can't forge a `state` value that
 * links an installation to a workspace they don't belong to; timestamped
 * so a leaked/old value can't be replayed indefinitely.
 */

const TTL_MS = 10 * 60 * 1000; // 10 minutes — long enough to complete the GitHub install UI, short enough to limit replay risk.

interface InstallStatePayload {
  workspaceId: string;
  userId: string;
  nonce: string;
  issuedAt: number;
}

function sign(data: string): string {
  return createHmac("sha256", env.APP_SECRET).update(data).digest("hex");
}

export function signInstallState(workspaceId: string, userId: string): string {
  const payload: InstallStatePayload = {
    workspaceId,
    userId,
    nonce: randomBytes(9).toString("base64url"),
    issuedAt: Date.now(),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function verifyInstallState(
  token: string,
): { workspaceId: string; userId: string } | null {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;

  const expected = sign(encoded);
  const actualBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (actualBuf.length !== expectedBuf.length || !timingSafeEqual(actualBuf, expectedBuf)) {
    return null;
  }

  let payload: InstallStatePayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (
    typeof payload.workspaceId !== "string" ||
    typeof payload.userId !== "string" ||
    typeof payload.issuedAt !== "number"
  ) {
    return null;
  }

  if (Date.now() - payload.issuedAt > TTL_MS) return null;

  return { workspaceId: payload.workspaceId, userId: payload.userId };
}
