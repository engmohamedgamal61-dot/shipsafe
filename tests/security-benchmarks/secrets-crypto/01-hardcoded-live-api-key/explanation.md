# secrets-crypto-01-hardcoded-live-api-key

**What this tests:** the plain, unambiguous secret-leakage case — a
credential written as a string literal in source, with no `.env`
indirection, no placeholder labeling, and no test-fixture context to
excuse it.

**Why it's shaped this way:** the key is given a real Anthropic key's
shape (`sk-ant-api03-` prefix, plausible length/charset) rather than an
obviously-fake value like `"YOUR_API_KEY"`, so scoring actually requires
the reviewer to notice a hardcoded literal in a security-sensitive
constructor call, not just string-match on placeholder-looking text.

**What would make this fixture wrong:** if the key were read via
`process.env.ANTHROPIC_API_KEY` (the actual, safe pattern used
elsewhere in this codebase), or if it were clearly labeled as a
docs/example placeholder (e.g. in a `.env.example` file or a code
comment saying "replace with your own key").
