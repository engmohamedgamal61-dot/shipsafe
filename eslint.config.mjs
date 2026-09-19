import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // A leading underscore is our convention for "required by an
      // interface but unused in this implementation" (e.g. `_userId` in
      // an adapter method where RLS — not application code — does the
      // scoping). See src/server/repositories/supabase-adapter.ts.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Security-benchmark fixture source snippets are deliberately
    // minimal, illustrative vulnerable/safe code samples — never
    // imported or executed by the app, not meant to lint clean (see
    // tests/security-benchmarks/README.md).
    "tests/security-benchmarks/**/fixture/**",
    // Code-benchmark fixture source snippets are likewise minimal,
    // illustrative buggy/safe code samples (some deliberately import a
    // sibling module that doesn't exist in the fixture set, since only
    // the shown function's own logic is under test) — never imported or
    // executed by the app, not meant to lint/typecheck clean (see
    // tests/code-benchmarks/README.md).
    "tests/code-benchmarks/**/fixture/**",
    // Database-benchmark fixture source snippets are likewise minimal,
    // illustrative migration/query samples (some deliberately import a
    // service-client module path that isn't real in the fixture set,
    // since only the shown migration/query's own logic is under test) —
    // never imported or executed by the app, not meant to lint/typecheck
    // clean (see tests/database-benchmarks/README.md).
    "tests/database-benchmarks/**/fixture/**",
    // Architecture-benchmark fixture source snippets are likewise
    // minimal, illustrative module samples (some deliberately import a
    // sibling module, a UI component, or a vendor SDK type that isn't
    // real in the fixture set, since only the shown module's own
    // structure is under test) — never imported or executed by the
    // app, not meant to lint/typecheck clean (see
    // tests/architecture-benchmarks/README.md).
    "tests/architecture-benchmarks/**/fixture/**",
  ]),
]);

export default eslintConfig;
