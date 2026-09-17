import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies a GitHub webhook's `X-Hub-Signature-256` header against the
 * raw request body. Pure and side-effect free so it's cheap to unit test
 * without spinning up a request — see `webhook-signature.test.ts`.
 *
 * MUST be called with the raw request body text (not a re-serialized
 * `JSON.stringify` of the parsed payload) — GitHub signs the exact bytes
 * it sent, and re-serializing can produce different bytes (key order,
 * whitespace) that would make a legitimate request fail verification.
 */
export function verifyGithubSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader) return false;

  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;

  const actualBuf = Buffer.from(signatureHeader);
  const expectedBuf = Buffer.from(expected);

  // timingSafeEqual throws on length mismatch rather than returning
  // false — guard explicitly so a malformed/short header can't crash the
  // webhook handler.
  if (actualBuf.length !== expectedBuf.length) return false;

  return timingSafeEqual(actualBuf, expectedBuf);
}
