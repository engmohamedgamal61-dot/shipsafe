# llm-ai-01-prompt-injection-unsafe-tool-use

**What this tests:** whether the reviewer can find two distinct,
chained LLM-security root causes in the same short function, rather
than stopping after the first (more obviously named) one, or merging
them into a single vague "AI safety" finding.

**Why it's shaped this way:** each half is a direct copy of one of
§3.17's own two vulnerable-pattern snippets — the no-delimiter prompt
concatenation, and the parse-and-apply-model-output-as-a-file-write
with no diff-membership check — deliberately chained (the second is
only reachable via the first) to mirror a realistic "auto-fix" feature
shape, since that's the highest-agency, highest-risk feature class
§3.17's LLM06 section calls out.

**What would make this fixture wrong:** if `diffText` were wrapped in
explicit delimiters with a "treat as data" system instruction (closing
req-1), or if `result.filePath` were validated against the PR's actual
changed-file list before `applyFileEdit` were called (closing req-2) —
either fix alone would drop this fixture from `vulnerable` to at most a
single-finding case; both together would make it `safe`, matching the
real production pattern in `providers/prompt.ts` +
`anthropic-provider.ts` that the plan's own `llm-ai-02` fixture is
built around.
