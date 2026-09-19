/**
 * Benchmark-only category compatibility layer. Maps a legacy/plain
 * category string — the shape today's production reviewer actually
 * emits (`providerFindingSchema.category` in `src/domain/schemas.ts`
 * is an unconstrained `z.string().min(1)`, no canonical format) — to a
 * canonical `domain.subcategory` benchmark category (`schema.ts`'s
 * `categorySchema`), so unmodified production output can still be
 * matched against fixtures whose ground truth uses the canonical
 * convention.
 *
 * This mapping is consumed ONLY by `scorer.ts`. It never feeds back
 * into anything production reads or writes — "canonical category" is
 * benchmark-only metadata, exactly as before this layer existed; this
 * module just gives the scorer a deterministic way to recognize a
 * legacy string as equivalent to one, where that equivalence is
 * actually unambiguous.
 */

/**
 * Explicit, hand-curated, one-way lookup table. No fuzzy/substring/
 * prefix matching, no semantic guessing — a legacy string maps to
 * exactly one canonical category, or it doesn't map at all (`unknown`,
 * preserved as-is for reporting).
 *
 * Two shapes of entry, both deliberate:
 * - A legacy string names a whole domain with no further detail
 *   (`"access-control"`, `"webhooks"`) → maps to that domain's
 *   `.generic` subcategory. Mapping it to any ONE specific subcategory
 *   (e.g. `.idor`) would be guessing which specific check the reviewer
 *   actually meant — exactly the "ambiguous mapping silently choosing
 *   a subcategory" this layer must never do.
 * - A legacy string already names a specific, unambiguous pattern
 *   (`"sql-injection"`, `"rls"`, `"toctou"`, `"prompt-injection"`) →
 *   maps directly to the matching canonical subcategory, because the
 *   legacy string itself already carries that specificity — no
 *   guessing involved, just a spelling/format normalization.
 */
export const LEGACY_CATEGORY_MAP: Readonly<Record<string, string>> = {
  // access-control
  "access-control": "access-control.generic",
  "broken-access-control": "access-control.generic",
  idor: "access-control.idor",

  // injection — "injection" alone is ambiguous (sql? command? other?);
  // a legacy string naming the specific injection type is not.
  injection: "injection.generic",
  "sql-injection": "injection.sql",
  "command-injection": "injection.command",

  // webhooks
  webhooks: "webhook.generic",
  "webhook-security": "webhook.generic",
  "webhook-signature": "webhook.signature-verification",

  // database
  database: "database.generic",
  rls: "database.rls",

  // multi-tenant
  "multi-tenant": "multi-tenant.generic",
  "tenant-isolation": "multi-tenant.tenant-isolation",

  // concurrency — "race-condition" is a broader term than TOCTOU
  // specifically (could be a different race shape), so it stays
  // generic; "toctou" itself is unambiguous.
  concurrency: "concurrency.generic",
  "race-condition": "concurrency.generic",
  toctou: "concurrency.toctou",

  // secrets-crypto
  "secrets-crypto": "secrets-crypto.generic",
  secrets: "secrets-crypto.generic",
  "hardcoded-secret": "secrets-crypto.hardcoded-secret",

  // llm-ai
  "llm-ai": "llm.generic",
  llm: "llm.generic",
  "prompt-injection": "llm.prompt-injection",
  "excessive-agency": "llm.excessive-agency",

  // auth — "broken authentication"/"broken auth" is itself a specific,
  // recognized OWASP-style vulnerability name (like "sql-injection"),
  // not a whole-domain umbrella term the way "webhooks" is — maps
  // directly, per this table's own documented convention. Added after a
  // real production run used both spellings for a genuine, correctly-
  // evidenced missing-signature-verification finding (see
  // `webhooks-01-no-signature-verification`'s `req-1.alternate_categories`).
  "broken-auth": "auth.broken-authentication",
  "broken-authentication": "auth.broken-authentication",
};

/**
 * Case-sensitive, exact-string lookup only — deliberately no
 * normalization (lowercasing, trimming, punctuation-folding) beyond
 * exact match. Adding fuzzy matching here would reintroduce the same
 * "silently choose a specific meaning" risk the table's own design
 * avoids; an unrecognized string stays unrecognized rather than being
 * coerced into a guess.
 *
 * Returns `undefined` for anything not in the table — including,
 * deliberately, any string already in the canonical `domain.subcategory`
 * format (this layer maps LEGACY strings forward; a category that's
 * already canonical needs no normalization and is compared directly by
 * the caller).
 */
export function normalizeCategory(rawCategory: string): string | undefined {
  return LEGACY_CATEGORY_MAP[rawCategory];
}
