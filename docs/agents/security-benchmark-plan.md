# Security Reviewer v2 — Benchmark Plan

Status: **design only**. No fixtures are implemented by this document —
see §6 for the Phase 1 fixture list (names + what each tests, not code).
This plan is written against `docs/agents/security-reviewer-v2.md`
(the "spec") and should be read alongside it; every metric and scoring
rule below exists to check the spec's own rules (§4 finding schema, §5
anti-patterns, §7/§8 rubrics) are actually followed, not to introduce a
new, separate standard of correctness.

## 1. Benchmark Goals

**Updated 2026-09-19 (standards refresh).** The benchmark exists to
answer, with a number, questions the spec can only state as intent —
and the goal is explicitly **not just vulnerability recall**: a
reviewer that finds every real vulnerability but also hallucinates
files, fabricates evidence, or inflates severity on ambiguous code is
not a passing reviewer, and the metric set below is designed so no
single number can hide that trade-off.

Every metric is tagged **Gating** (blocks the acceptance bar, §7 of
this plan) or **Informational** (tracked and reported, doesn't block
release on its own) — see §7 for the full pass/fail bar these feed.
Also tagged: **Computable now** (works against today's
`ProducedFinding` shape — `adapter.ts`'s output, §5.4) vs. **Deferred**
(requires a `ProducedFinding` schema extension not yet built — see the
note below the table).

| Metric | What it measures | Spec section it checks | Gating? | Computable now? |
|---|---|---|---|---|
| **Precision** | Fraction of produced findings that were correct (matched, not a false positive of any kind). | §3 (taxonomy coverage) | Informational | Yes |
| **Recall** | Fraction of real, intended vulnerabilities the reviewer actually found. | §3 taxonomy coverage | Informational | Yes |
| **P0/P1 recall** | Recall, restricted to the highest-severity required findings — missing a P0 matters more than missing a Nit, and an aggregate recall number can hide that. | §7 rubric | **Gating** | Yes |
| **Safe-code false-positive rate** | Of `safe`/`false_positive_trap`-tagged fixtures specifically, the fraction where the reviewer produced ANY finding at all — distinct from the general false-positive rate below because a false positive on code that's DEFINITIVELY safe is a sharper, more diagnostic failure than one on merely out-of-scope code. | §3's "common false positives" per domain | **Gating** | Yes |
| **Ambiguous-case overclaim rate** | Of `ambiguous`-tagged fixtures, the fraction where the reviewer asserted a confident (medium/high) finding instead of `needs_more_context`/zero findings/a low-confidence optional match. | §4.1's evidence-state rule (new — spec 2026-09-19 refresh) | **Gating** | Yes |
| **Hallucinated file/path rate** | Fraction of findings citing a file/line not actually present in the fixture's file set. | §5 ("no hallucinated files") | **Gating** | Yes |
| **Fabricated-evidence rate** | Fraction of findings containing a deterministically-provable false backtick-quoted code claim (§4.1 of this plan's own scoring section — not the spec's §4). | §5, spec §4.1 (evidence bar) | **Gating** | Yes |
| **Duplicate root-cause rate** | Fraction of produced findings that are a redundant second (or later) match against an already-matched ground-truth entry, rather than N call sites correctly merged into one finding. | Spec §4.3 | Informational | Yes |
| **Severity calibration** | Whether a matched finding's severity falls inside the fixture's expected range — split into inflation vs. understatement, since the spec treats them asymmetrically. | Spec §7 rubric | **Gating** (inflation on an `ambiguous` fixture specifically — see §7 of this plan); Informational otherwise | Yes |
| **Confidence calibration** | Whether findings marked `high` confidence are actually correct at a high rate, and `low`-confidence findings correspondingly lower — does stated confidence *mean* anything, monotonically. | Spec §8 rubric | Informational | Yes |
| **Exploit-path validity** | Whether a matched finding's `security_consequence`/`attack_preconditions`/`exploit_scenario` actually form a concrete, traceable source→boundary→sink→impact chain (spec §2.1), not just a plausible-sounding narrative. | Spec §2.1, §4.1 (evidence states) | Target (§7) — **not yet Gating**, see note below | **Deferred** |
| **Standards-mapping accuracy** | Whether a finding's `standards` citation is a real id from the spec's §1 baseline (not invented) and actually applies to the finding's category. | Spec §1, §4 (`standards` field) | Informational | **Deferred** |
| **Remediation quality** | Whether `remediation` is present, specific, and (where applicable) references the spec's own safe pattern — vs. generic/absent. | Spec §4 (`remediation` field) | Informational | **Deferred** |

**Updated 2026-09-19 (reproducibility/evidence-model hardening pass —
Tasks 1–9).** The schema-extension half of the gap below is now
CLOSED: `producedFindingSchema` (`scorer.ts`) carries optional
`evidenceState`, `securityConsequence`, `attackPreconditions`,
`exploitScenario`, and `standards` fields (Tasks 1/2), and
`adaptPersistedFindings` (`adapter.ts`) documents, field by field, that
none of the five is ever invented — production's persisted `Finding`
shape still has no equivalent, so every adapted finding leaves all five
`undefined`. What remains genuinely Deferred is the SCORING logic, not
the schema:

- **Exploit-path validity** — even with the three chain fields present
  on a finding, judging whether they form a genuine, traceable
  source→boundary→sink→impact chain (vs. a plausible-sounding
  narrative) is a semantic judgment this deterministic scorer cannot
  make; §7.1 already requires MANUAL spot-checking of every P0/P1
  finding for exactly this reason. `deferred-metrics.ts`'s
  `computeDeferredMetrics()` always reports `"not_measurable"` for this
  metric, with the count of chain-field-bearing findings that would need
  that manual check surfaced in the reason text — never a fabricated
  automated verdict.
- **Standards-mapping accuracy** — `standardsCitationSchema`
  (`scorer.ts`) now rejects a syntactically fabricated standards ID at
  parse time (format-only, per framework — see that schema's own
  comment), which is real, enforced validation, but confirming a
  *syntactically valid* ID actually APPLIES to its finding's category
  requires either a curated category→standards-id table (not built) or
  a judgment call — still Deferred, `computeDeferredMetrics()` reports
  `"not_measurable"`.
- **Remediation quality** — `ProducedFinding` deliberately gained no
  `remediation` field in this pass (Task 2's field list was
  `security_consequence`/`attack_preconditions`/`exploit_scenario`/
  `standards` only) — always `"not_measurable"` as a structural fact,
  not a per-run observation.

See `src/server/security-benchmarks/deferred-metrics.ts` for the actual
plumbing (`DeferredMetricResult`, always either `"not_measurable"` with
a specific reason or a future real `"measured"` value — never a
fabricated/default score in between) and
`src/server/security-benchmarks/report.ts`'s `buildBenchmarkReport()`
for how these surface in a run's report alongside the version/
reproducibility metadata from §8.

## 2. Fixture Categories

Two independent dimensions, not one flat list:

- **Domain** — which of the taxonomy's 18 sections (§3.1–§3.18 in the
  spec — §3.18 Agentic AI Security added in the spec's 2026-09-19
  refresh) the fixture is primarily about. This is the fixture's
  directory (§5).
- **Archetype tags** — what *kind* of test case it is, independent of
  domain. A fixture can carry more than one tag (e.g. a vulnerable
  fixture that's also multi-file).

| Tag | Meaning | Correct benchmark answer |
|---|---|---|
| `vulnerable` | Contains a real, intended vulnerability. | Every `required_findings[]` entry matched, correct severity/category range. |
| `safe` | Looks like it could be flagged, but the pattern is actually correct (a genuine negative, not a trick). | Zero findings, full stop — `required_findings` and `optional_findings` are both always empty for a `safe` fixture. |
| `ambiguous` | Evidence is genuinely incomplete (e.g. a check plausibly lives in code not included). | Zero findings, an explicit `needs_more_context` signal, or a single `low`-confidence finding matching an `optional_findings[]` entry — never a confident, definitive finding. `required_findings` is always empty for an `ambiguous` fixture (§3.1). |
| `false_positive_trap` | Deliberately resembles a vulnerable pattern from §3's "vulnerable pattern" snippets, but a specific detail (already-validated input, hardcoded host, correct deny-all RLS, etc.) makes it safe. | Zero findings — this specifically tests the "common false positives" list in each §3 subsection. Same zero-findings rule as `safe` (see above). |
| `multi_file` | The vulnerability (or its correct fix) spans more than one file. | Findings correctly reference every relevant file; a shared root cause across files is one finding, not one per file (§4.3). |
| `concurrency` | Tests a race-condition/TOCTOU/claim-pattern scenario specifically. | Correctly distinguishes a real race from a safe atomic pattern. |

Every fixture has exactly one **domain** (its folder) and one or more
**archetype tags** (its manifest's `tags` array — see §3).

## 3. Expected-Answer Schema

One manifest file per fixture (`expected.json`, format fixed by this
schema, enforced by `src/server/security-benchmarks/schema.ts` — see §5
for where it lives on disk):

```json
{
  "fixture_id": "access-control-01-idor-service-role-no-owner-check",
  "domain": "access-control",
  "tags": ["vulnerable", "multi_file"],
  "spec_ref": "3.1",
  "description": "One-sentence human summary of what this fixture is testing.",
  "files": ["src/route.ts", "src/lib/data-access.ts"],
  "expected": {
    "needs_more_context_acceptable": false,
    "allowed_categories": ["access-control.idor"],
    "prohibited_categories": ["injection.sql", "secrets-crypto.hardcoded-secret"],
    "required_findings": [
      {
        "id": "req-1",
        "rule_id": "SEC-AUTHZ-001",
        "category": "access-control.idor",
        "files": ["src/route.ts", "src/lib/data-access.ts"],
        "line_ranges": { "src/route.ts": [12, 18], "src/lib/data-access.ts": [4, 9] },
        "severity_range": ["P0", "P0"],
        "confidence_range": ["medium", "high"],
        "exploit_preconditions": "none — unauthenticated request with a guessed/known review id",
        "must_reference_root_cause_once": true
      }
    ],
    "optional_findings": []
  },
  "explanation": "Longer note for a human maintaining this fixture: why it's shaped this way, what mistake it's designed to catch."
}
```

### 3.1 Required vs. optional vs. prohibited vs. safe vs. ambiguous

Five distinct concepts, previously conflated into a single
`finding_count.{min,max}` range — removed, because that range couldn't
tell "the reviewer is required to find this" apart from "the reviewer
is allowed to also find this," which produced two real bugs while
authoring the first 10 fixtures (see the bottom of this section):

| Concept | Manifest field | Meaning |
|---|---|---|
| **Required finding** | `required_findings[]` | A vulnerability the reviewer is expected to detect. Missing one costs points (§4.3); every entry must eventually be matched for full credit. |
| **Optional / acceptable finding** | `optional_findings[]` | A legitimate secondary observation that's allowed but must **never** be required for full credit — matching one is never penalized, and never scored as a false positive, but a fixture still passes with zero of them produced. |
| **Prohibited finding** | `prohibited_categories`, plus the strict default-deny rule in §4.1 | A finding that's a false positive, a hallucination, a duplicate root cause, or an explicitly wrong interpretation for this fixture. |
| **Safe fixture** | `tags` includes `safe` or `false_positive_trap` | Expected result is zero findings — enforced at the schema level: both `required_findings` and `optional_findings` must be empty. |
| **Ambiguous fixture** | `needs_more_context_acceptable: true` | Preferred result is `needs_more_context` or zero findings. `required_findings` must be empty (enforced at the schema level — **do not encode an ambiguous/conditional observation as a required finding**, that's exactly the bug this rule exists to prevent). A conditional observation may still live in `optional_findings[]`, but only at `confidence_range` max `"low"` (also schema-enforced) — a confident finding on an ambiguous fixture is never correct. |

**Why `finding_count` was removed, not widened again:** the first 10
fixtures hit this ambiguity twice. `webhooks-01` has one required
finding (missing signature verification) and one genuinely separate,
non-required observation (missing idempotency) in the same few lines;
the original fix was to widen `finding_count.max` from 1 to 2, but
nothing then said *which* of the (up to 2) findings was required and
which was merely tolerated — a reviewer that found only the
idempotency issue and missed the actual required signature check would
have scored identically to one that correctly found both. Worse,
`multi-tenant-04` (the `ambiguous` fixture) had its one conditional
observation living in `required_findings[]` at the same time as
`needs_more_context_acceptable: true` — a direct contradiction, since a
required finding is by definition something every correct run must
produce. `optional_findings[]` fixes both: it gives the
"allowed-but-not-required" case an actual home instead of a widened
count range.

### 3.2 Field reference

| Field | Purpose |
|---|---|
| `allowed_categories` | **Allowed finding categories.** Necessary but **not sufficient** for correctness — a finding in an allowed category that doesn't correspond to any `required_findings[]`/`optional_findings[]` entry is still an `unsupported_extra` (§4.1), not an automatic pass. Empty for a fixture whose only correct answer is zero findings. |
| `prohibited_categories` | Categories that are explicitly, definitely wrong for this fixture — a documentation aid on top of the stricter rule the scorer actually enforces (any category **not** in `allowed_categories` is prohibited by default — see §4.1). Must not overlap `allowed_categories` (schema-enforced). |
| `required_findings[].rule_id` / `optional_findings[].rule_id` | **Required** on every ground-truth entry. The stable benchmark identity for that root cause — see §3.4. The scorer's primary match key (§4.1); `category`/file/line is now the fallback for a produced finding that doesn't supply one. |
| `required_findings[].category` / `optional_findings[].category` | Optional — a specific sub-check name in the canonical `domain.subcategory` format (§3.3), **not** the fixture's whole domain. Only needed (and schema-required) when a fixture has two or more ground-truth entries whose `files`/`line_ranges` overlap — without a category to disambiguate which one a produced finding at that shared location corresponds to, the fallback match path can't tell them apart. |
| `required_findings[].severity_range` / `optional_findings[].severity_range` | **Expected severity range**, as a `[min, max]` pair over `Nit < P2 < P1 < P0`. A matched *required* finding outside this range is a severity-accuracy miss (inflation if above `max`, understatement if below `min`) — optional matches are tracked for visibility but not penalized this way (§4.3). |
| `required_findings[].confidence_range` / `optional_findings[].confidence_range` | **Expected confidence range**, `[min, max]` over `low < medium < high`. Feeds the suite-level calibration metric (§4.4); on an `ambiguous` fixture's `optional_findings[]`, the max must be `"low"` (schema-enforced). |
| `files` / `required_findings[].line_ranges` / `optional_findings[].line_ranges` | **Exact vulnerable file/region.** The ground truth a produced finding's `file`/`line` is matched against (§4.1) and the hallucination check is run against (any produced finding citing a file *not* in this fixture's `files` list is a hallucination — a hard failure, §4.2, regardless of matching). |
| `required_findings[].exploit_preconditions` / `optional_findings[].exploit_preconditions` | Human-readable ground truth for what the fixture's own preconditions actually are — not scored directly, but used when hand-auditing whether a passing/failing score was for the right reason. |
| `needs_more_context_acceptable` | **Whether "needs more context" is a correct answer.** `true` for every `ambiguous`-tagged fixture (and only those) — see §3.1. |

### 3.3 Category convention

Every category a fixture manifest declares (`allowed_categories`,
`prohibited_categories`, `required_findings[]`/`optional_findings[]`'s
optional `category`) MUST follow the canonical format:

```
domain.subcategory
```

Both sides lowercase kebab-case, exactly one `.` separator (enforced by
`schema.ts`'s `categorySchema`). Examples used across the current
fixture set:

```
access-control.idor
access-control.vertical-escalation
auth.session-fixation
database.rls
webhook.signature-verification
webhook.idempotency
injection.sql
llm.prompt-injection
llm.excessive-agency
```

`domain` is not required to equal the fixture's directory name (e.g. a
`database` fixture may legitimately also declare
`multi-tenant.tenant-isolation` as an alternate acceptable
categorization of the same finding, as `database-01` does) — it names
whichever §3 spec section the category actually belongs to.

**Deliberately NOT enforced on a *produced* finding's category** in
`scorer.ts`'s `producedFindingSchema` — today's production reviewer
emits plain, unmigrated strings (`"access-control"`, not
`"access-control.idor"`). Requiring the canonical format there would
make it impossible to benchmark unmodified production output at all,
which would contradict the "no production changes" constraint every
one of these benchmark-design tasks has run under. The convention is a
ground-truth authoring discipline, not (yet) a contract production has
to honor — see §5.4's remaining-gap note.

**A single ground-truth entry with a specific meaning may legitimately
have more than one acceptable canonical categorization** — e.g.
`database-01-rls-never-enabled-on-tenant-table`'s single required
finding has `allowed_categories: ["database.rls",
"multi-tenant.tenant-isolation"]` but its `required_findings[0]` itself
declares no `category` at all, so the fallback match (§4.1) doesn't
force a reviewer to pick one specific labeling. Setting a `category` on
a ground-truth entry narrows what a produced finding must claim to
match it via the fallback path — only do this when the fixture actually
needs that disambiguation (an overlapping second entry), not reflexively
on every entry.

### 3.4 Rule IDs — stable benchmark identities

Every ground-truth entry (`required_findings[]`/`optional_findings[]`)
has a **required** `rule_id`, format `SEC-<DOMAIN>-NNN` (schema-enforced
by `ruleIdSchema`), e.g. `SEC-AUTHZ-001`, `SEC-WEBHOOK-002`,
`SEC-DB-001`, `SEC-LLM-001`. Must be unique within a fixture
(schema-enforced) — not necessarily unique across the whole suite (two
different fixtures may legitimately reuse the same domain+number for
the same *kind* of bug pattern, the way a bug catalog would).

What a `rule_id` IS: a stable identity for "this specific root cause in
this specific fixture," used by the scorer as the primary,
unambiguous match key (§4.1) — a produced finding citing the exact
right `rule_id` is trusted as a match even if its cited line has
drifted slightly from the declared region.

What a `rule_id` is NOT:
- **Not derived from, or meaningful via, its numeric portion alone.**
  `NNN` is a per-domain sequence number, nothing more — `SEC-AUTHZ-002`
  is not "worse than," "newer than," or otherwise ordered relative to
  `SEC-AUTHZ-001`. Do not infer severity, chronology, or priority from
  it.
- **Not a CWE/OWASP replacement.** Standards mappings (CWE numbers,
  OWASP Top 10 IDs, ASVS chapters) belong to the spec's own taxonomy
  (`docs/agents/security-reviewer-v2.md` §1) and are a completely
  separate axis — a `rule_id` identifies a benchmark fixture's root
  cause; a CWE number classifies a vulnerability *class*. Many
  different `rule_id`s can map to the same CWE, and this plan doesn't
  attempt to keep the two in sync.

### 3.5 Confidence mapping: persisted numeric confidence → benchmark bucket

The ONE canonical conversion from a persisted `Finding.confidence`
(`src/domain/types.ts`, a number in `[0, 1]`) to a benchmark confidence
bucket (`"low"` | `"medium"` | `"high"`), implemented once in
`src/server/security-benchmarks/confidence-mapping.ts`
(`mapNumericConfidenceToBucket`) and used by nothing else — every other
place in this module that needs bucketed confidence (currently just
`adapter.ts`) calls this function rather than re-deriving thresholds:

| Numeric confidence | Bucket |
|---|---|
| `[0.00, 0.50)` | `low` |
| `[0.50, 0.80)` | `medium` |
| `[0.80, 1.00]` | `high` |

Lower bound inclusive, upper bound exclusive (except `high`, which is
closed at `1.0`). A value outside `[0, 1]` (or non-finite) is a
validation failure, not clamped.

### 3.6 Category compatibility layer (benchmark-only)

Fixture ground truth uses the canonical `domain.subcategory` format
(§3.3); today's production reviewer does not, and won't until it's
changed (out of scope for every task in this benchmark-design effort
so far). `src/server/security-benchmarks/category-compat.ts` bridges
the gap with an explicit, hand-curated, one-way lookup table
(`LEGACY_CATEGORY_MAP`) — no fuzzy/substring/prefix matching, no
semantic guessing. Two shapes of entry:

- A legacy string naming a whole domain with no further detail
  (`"access-control"`, `"webhooks"`) maps to that domain's `.generic`
  subcategory — mapping it to any ONE specific subcategory would be
  guessing which specific check the reviewer meant.
- A legacy string that already names a specific, unambiguous pattern
  (`"sql-injection"` → `injection.sql`, `"rls"` → `database.rls`,
  `"toctou"` → `concurrency.toctou`, `"prompt-injection"` →
  `llm.prompt-injection`) maps directly — the legacy string already
  carries that specificity, so this is a format normalization, not a
  guess.

An unrecognized legacy string maps to nothing (`normalizeCategory`
returns `undefined`) and is preserved as-is for reporting (§4.5) —
never coerced into a best-effort guess.

**This layer is benchmark-only metadata.** It is consumed exclusively
by `scorer.ts`; nothing in it is ever written back to a fixture
manifest or to anything production reads.

**How it participates in matching (§4.1):** the scorer tries an exact,
canonical-only category match FIRST; only if that finds nothing does
it retry with the compatibility mapping applied. This makes the two
cases distinguishable in the compatibility report (§4.5) — "matched
because the label was already canonical" vs. "matched only because the
compatibility layer bridged a legacy label."

**Generic mappings can never wrongly disambiguate overlapping
findings.** A `.generic` compatibility category is still just one
exact string; it can never satisfy an equality check against a
SPECIFIC sibling category (`"webhook.generic"` ≠
`"webhook.signature-verification"`). When two ground-truth entries
genuinely overlap in file/line (schema-required to each declare a
distinct, specific `category` — §3.2) and a produced finding's
category — raw or compatibility-normalized — is too generic to match
either one specifically, that finding stays unmatched
(`unsupported_extra`/`prohibited`, never silently attributed to either
entry) rather than being merged into whichever one happens to be
checked first.

**The category gate itself is conditional, not automatic.** Most
ground-truth entries have NO genuine overlap to disambiguate from — a
`category` set on one of those (for clarity/consistency, not
necessity) does not gate matching at all; file/line alone decides it,
regardless of what category label a real reviewer used. The gate is
only enforced for entries that actually share overlapping
files/line_ranges with a sibling (`scorer.ts`'s
`findEntriesNeedingDisambiguation`) — enforcing it universally would
make the benchmark unfairly strict against a real reviewer whose
category label simply doesn't match a canonical string that was never
load-bearing to begin with.

**`alternate_categories` — added after the first real production
baseline run (`BENCHMARK_SCHEMA_VERSION` `2.0.0`).** The generic-mapping
rule above correctly prevents a VAGUE label from disambiguating two
overlapping entries, but it left no way for a fixture author to
recognize that a DIFFERENT, still-specific-and-unambiguous label is also
a legitimate name for the same root cause — confirmed by a real run:
`webhooks-01`'s missing-signature-verification finding is validly
describable as `webhook.signature-verification` (this fixture's own
label) OR `auth.broken-authentication` (the model's actual, defensible
choice), and neither is a guess. `groundTruthFindingSchema.
alternate_categories` (`schema.ts`) lets an entry declare additional
canonical synonyms, explicit and hand-authored per entry — never
inferred from `category-compat.ts` or any heuristic. Two safeguards keep
this from reopening the exact ambiguity the gate above exists to
prevent:
- The schema's own overlap-validation (§3 above) now requires two
  overlapping entries' FULL category sets (`category` +
  `alternate_categories` combined) to be completely disjoint, not just
  their primary `category` fields.
- The scorer's disambiguation gate (`matchesByLocation`) checks a
  finding's category against the entry's full set — an alternate can
  only ever help THAT entry match; it can never cause a finding to be
  misattributed to a sibling, since disjointness is enforced at
  authoring time.

Applied so far to exactly one entry: `webhooks-01`'s `req-1` gained
`alternate_categories: ["auth.broken-authentication"]`, paired with a
new `category-compat.ts` entry (`"broken-auth"`/`"broken-authentication"`
→ `auth.broken-authentication`, following this table's own "a specific,
unambiguous legacy string maps directly" convention). See
`docs/agents/security-baseline-current.md`'s before/after addendum for
the confirmed effect on a real run.

### 3.7 Repository-scope findings (`file: null`)

Audited against the actual code (not assumed): production's own system
prompt (`src/server/review-engine/providers/prompt.ts`,
`buildReviewerSystemPrompt`) explicitly instructs the model — "Only
report a filePath/lineStart/lineEnd that actually appears in the diff
below... If you cannot point to a specific line, leave filePath and
line fields null and describe the issue in the finding text instead."
`providerFindingSchema` (`src/domain/schemas.ts`) types `filePath` as
nullable, and `anthropic-provider.ts`'s own hallucination check
(`f.filePath && !knownPaths.has(f.filePath)`) already treats `null` as
exempt, not as an error. This is a real, currently-active production
behavior, not a hypothetical — so the benchmark supports it rather than
rejecting it:

- `producedFindingSchema.file` is `string | null`. `null` never counts
  as `hallucinated_path` (there is nothing to check it against).
  `lineStart` must also be `null` whenever `file` is (schema-enforced)
  — a line number with no file is meaningless, matching the prompt's
  own "leave filePath AND line fields null" phrasing.
- A ground-truth entry opts in explicitly with
  `repository_scope: true` (default `false`) — never inferred. Only
  such an entry can be matched by a `file: null` produced finding; a
  fixture never *accidentally* accepts a location-less finding as a
  match for a root cause that's actually supposed to be pinned to a
  specific file/line. A `repository_scope` entry can still ALSO be
  matched by a finding that DOES cite one of its declared `files`
  directly — repository-wide doesn't mean file-citation is prohibited,
  just that it isn't required.
- `adapter.ts` passes `filePath: null` straight through as `file:
  null` — never invents a placeholder path. It rejects (fails
  validation) the one genuinely malformed combination: `filePath: null`
  with a non-null `lineStart`.
- Fabricated-evidence checking (§4.1) for a `file: null` finding
  checks its backtick-quoted spans against the fixture's ENTIRE
  combined source (every declared file), since there's no single file
  to pin the check to.

None of the current 10 fixtures need `repository_scope` yet (every
root cause so far is file-scoped) — the mechanism exists and is tested
synthetically (`scorer.test.ts`), ready for the first fixture that
needs it (a natural candidate: `ci-cd-01-pull-request-target-with-fork-head-checkout`,
§6, once implemented).

### 3.8 Ambiguous-fixture scoring without production's `needs_more_context`

Production has no way to emit the spec's §4.4 `needs_more_context`
status object at all (confirmed by the same audit as §3.7 — nothing in
`ReviewerRun`/`Finding` carries this signal). The benchmark's scoring
rule for `ambiguous` fixtures is deliberately built so this absence is
never penalized:

| Reviewer output | Scored as |
|---|---|
| Zero findings | Correct, cautious result — same credit as an explicit `needs_more_context` signal (§4.3's ambiguous bonus). |
| A single `low`-confidence finding matching the fixture's `optional_findings[]` entry | Also correct/acceptable — never required, never penalized. |
| A `medium`/`high`-confidence vulnerability assertion | Overconfident — classified `prohibited` (§4.1's ambiguous-overconfidence rule), regardless of whether it's otherwise well-evidenced. |
| An explicit `needsMoreContext: true` flag, with zero findings | Scored identically to zero findings with the flag absent/`false` — the flag is carried through (`ReviewerResult.needsMoreContext`) but never consulted by `scoreFixture`'s actual logic. |

The last row is the load-bearing one for this section: since
`needsMoreContext` is never read by the scorer at all, its absence
literally cannot penalize anything — pass/fail for an `ambiguous`
fixture is judged entirely from the `findings` array. Verified directly
(`scorer.test.ts`: scoring the same zero-finding result with the flag
`true` vs. `false` produces an identical score).

## 4. Scoring

Deterministic — no LLM-as-judge in the scoring loop itself (an LLM
grader could be used to help *author* fixtures, never to score a run;
scoring must be reproducible byte-for-byte from a reviewer's structured
output and the fixture's `expected.json`). Implemented in
`src/server/security-benchmarks/scorer.ts` (`scoreFixture` per fixture,
`aggregateScores` across a run).

The scorer's input is a **normalized reviewer result** — the spec's own
§4 raw output schema (`category`/`severity`/`confidence`/`file`/
`line`/`evidence`, plus a `needsMoreContext` flag for §4.4's status
object), not the persisted DB `Finding` shape in `src/domain/types.ts`
(numeric `confidence`, uppercase `"NIT"`). Translating a real reviewer
run's DB rows into this shape is a mapping step for whoever wires the
real reviewer into this scorer — out of scope here; see §5.4's new
entry.

### 4.1 Classifying every produced finding

**Updated 2026-09-19 (Task 1/5).** Every produced finding is classified
into **exactly one** of **eight** buckets (was seven before this
pass — `insufficient_evidence` is new), evaluated in this priority
order:

| # | Classification | Rule |
|---|---|---|
| 1 | `hallucinated_path` | Cites a non-null file not in the fixture's `files` list. **Hard failure** — see §4.2. A `null` file (§3.7) is never hallucinated — there's nothing to check it against. |
| 2 | `fabricated_evidence` | `evidence` contains a backtick-quoted `` `code span` `` that is deterministically provable false — see the fabrication rule below. **Hard failure** — see §4.2. |
| 3 | `insufficient_evidence` | **New, Task 1/5.** The finding's own `evidenceState` (`producedFindingSchema`) is `"needs_more_context"`. Checked BEFORE rule_id/category/location matching runs at all, so this classification overrides whatever a location/category match would otherwise have produced — "`needs_more_context` must never be treated as a confirmed vulnerability" is enforced structurally, not as a downstream score adjustment. Scored as a neutral, correct, cautious result (§4.3): never a false positive, but never a required/optional match either — a P0/P1 finding flagged this way is denied full credit by construction (it simply can't reach `matched_required`), and instead falls through to the ordinary "missed required finding" penalty if it was the only candidate for that entry. See §4.1a below for the full evidence-state gating rationale. |
| 4 | `matched_required` | Matches an **unconsumed** `required_findings[]` entry via the matching order below. On an `ambiguous` fixture, a match additionally requires `confidence: "low"` (required_findings is always empty there, so this only matters for rule 5). |
| 5 | `matched_optional` | Same test, against an **unconsumed** `optional_findings[]` entry. |
| 6 | `duplicate` | Matches a `required_findings[]`/`optional_findings[]` entry that an earlier produced finding (processed in array order) already matched. |
| 7 | `prohibited` | Falls through 1–6, **and** any of: category (raw or compatibility-normalized, §3.6) is explicitly in `prohibited_categories`; the fixture is `safe`/`false_positive_trap`-tagged (any finding at all is prohibited); the fixture is `ambiguous`-tagged and this finding's `confidence` isn't `"low"` (the overconfidence violation — the reason it didn't already match rule 4/5's optional entry); or — the strict default — the category (raw or normalized) simply isn't in `allowed_categories` at all. |
| 8 | `unsupported_extra` | Everything else: category (raw or normalized) **is** in `allowed_categories`, but doesn't correspond to any required/optional ground-truth entry. A plausible-domain, unconfirmed claim — per the task, being in an allowed category is necessary but not sufficient for correctness. |

### 4.1a Evidence-state gating (Tasks 1 & 5, new this pass)

`producedFindingSchema.evidenceState` (optional: `"proven"` |
`"strongly_supported"` | `"needs_more_context"`, mirroring spec §4.1)
lets the benchmark represent — and correctly, leniently score — a
finding that carries this signal, without requiring every reviewer
under test to have fully separated `needs_more_context` into the
spec's own distinct §4.4 status object yet.

- **`needs_more_context` must never be treated as a confirmed
  vulnerability** (Task 1). Enforced by classification order, not a
  score penalty: rule 3 above runs before rule_id/category/location
  matching, so such a finding can never become `matched_required`/
  `matched_optional` regardless of how well it would otherwise line up.
- **P0/P1 findings must be `proven` or `strongly_supported`** (spec
  §4.1). A P0/P1 finding with `evidenceState: "needs_more_context"` is
  classified `insufficient_evidence` (rule 3) — it "cannot receive full
  credit" (Task 5) in the strongest sense: zero credit, and if it was
  the only candidate for a `required_findings[]` entry, that entry is
  scored as a normal miss (§4.3's usual −1/−2 penalty).
- **A high-severity finding without a valid evidence state is flagged
  in diagnostics, not automatically failed** (Task 5). `FixtureScore.
  evidenceStateDiagnostics` (`scorer.ts`) counts every PRODUCED finding
  (not only matched ones) with severity P0/P1, split into
  `p0p1Measurable` (`proven`/`strongly_supported`), `p0p1NotMeasurable`
  (no `evidenceState` at all), and `p0p1Violations`
  (`needs_more_context`). `aggregateScores()` sums these suite-wide as
  `SuiteMetrics.evidenceState`, plus a `coverageRate` (`p0p1Measurable /
  p0p1Total`, reported as `1` when nothing to measure).
- **Missing `evidenceState` from current production output is
  `p0p1NotMeasurable`, never a violation** (Task 5). Production's
  persisted `Finding` shape has no such field at all
  (`adapter.ts` never invents one — see its own doc comment) — an
  unmodified production run must never be penalized for a signal it
  structurally cannot supply. This is the FIRST compatibility baseline
  this section's own audit (§9.4) flagged as needed; it's why every
  metric that depends on `evidenceState` is reported, never gated, for
  a run scored through `adapter.ts`.
- **Future v2 reviewer runs must provide it before passing the full
  production gate** (Task 5) — i.e. once a reviewer emits
  `evidenceState` directly (bypassing `adapter.ts`), §7.1's
  acceptance bar should require `p0p1NotMeasurable === 0` for that run
  to count toward a release decision; not yet enforced as a numeric
  threshold here, since no reviewer emits this field yet to hold to it.
- **Ambiguous fixtures may accept `needs_more_context` as a correct,
  cautious result** (Task 1) — an `insufficient_evidence`-classified
  finding is never `prohibited`, so it never blocks `passed` and never
  blocks the safe/ambiguous `+1` "correctly declined to assert" bonus
  (§4.3).
- **Safe fixtures must still prefer zero confirmed findings** (Task 1)
  — a `needs_more_context`-flagged finding on a `safe` fixture is not
  penalized as a false positive (same reasoning as the ambiguous case
  above), but it is scored IDENTICALLY to zero findings, never better —
  zero findings remains the ideal, ceiling-scoring answer; hedging is
  tolerated, not separately rewarded above the ceiling zero findings
  already reaches.

**Fabricated-evidence detection.** Deliberately does NOT require
verbatim source-code quotation — production's `description`/`evidence`
is free-form prose (§3.5's `adapter.ts` note), and requiring an exact
match would misclassify a legitimate paraphrase as fabrication. Only a
backtick-quoted `` `span` `` within the evidence text is ever checked;
prose outside backticks is a paraphrase, never a checkable claim, and
is never flagged, however much it paraphrases:

- A span is checked (after whitespace-collapsing both it and the
  source, and stripping a single trailing `;`/`,` from the span) as a
  substring of the cited file's actual content (or, for a `file: null`
  finding, the fixture's entire combined source — §3.7). Not found →
  `fabricated_evidence`. This deliberately catches BOTH an invented
  identifier/function name (`` `validateOwnership()` `` that doesn't
  exist anywhere) and an invented code *behavior* (a quoted line
  describing logic that isn't there) with the same mechanism — quoting
  something in backticks is an explicit "this is what the code says"
  claim, and that claim is either true or false, deterministically.
- Zero backtick-quoted spans (pure prose) → `hasFabricatedCodeClaim`
  returns `false` unconditionally; the finding proceeds through normal
  matching, exactly as if its evidence were fine. This is the rule
  that makes "if deterministic verification cannot establish
  fabrication, do not classify it as `fabricated_evidence`" concrete:
  there is no deterministic way to verify a paraphrase, so it's simply
  never tried.
- A non-verbatim but ACCURATE backtick-quoted fragment (reformatted,
  shortened, missing trailing punctuation) still passes, because it's
  still a genuine substring after normalization — only a span that
  truly isn't there fails.
- Any single unfound span is sufficient to flag the whole finding, even
  alongside other, accurate spans in the same evidence text.

**Updated after the first real production baseline run
(`BENCHMARK_SCHEMA_VERSION` `2.0.0`) — three additional narrowings, each
confirmed necessary by an actual reviewer output the original rule
mis-scored:**
- **Case-folding.** The substring check now compares case-insensitively.
  A real run's reviewer reproduced a fixture's own lowercase SQL comment
  in conventional uppercase keyword style (`ALTER TABLE ... ENABLE ROW
  LEVEL SECURITY` vs. the source's lowercase) and was wrongly hard-failed
  for the casing alone — a genuinely accurate quote, not a fabrication.
- **Illustrative-example exemption.** A span introduced by an explicit
  marker ("e.g.", "for example", "such as", "like") is exempted, UNLESS
  it's shaped like a specific function/variable reference (a bare
  identifier or an `identifier(...)` call) — narrowed this way
  specifically so "e.g." can never be used to smuggle a fabricated code
  claim past the check; only payload/data-shaped examples (an attack
  string, a sample value) are actually excused. Confirmed necessary: a
  real finding's accurate SQL-injection quote was disqualified only
  because the SAME finding also backtick-quoted an illustrative
  attack-payload example (`` `' OR '1'='1` ``) elsewhere in its prose.
- **Dotted-API-reference exemption.** A bare dotted identifier chain
  (`pg.Pool.query`) is exempted when EVERY dot-separated segment is
  independently a real token somewhere in the source — even though the
  exact concatenation never has to appear verbatim (a generic library
  reference, not a diff-line quote). Confirmed necessary by the same
  real finding referencing `` `pg.Pool.query` `` generically.

**Deliberately still NOT exempted, by design — do not weaken further:**
a backtick span that paraphrases an already-quoted expression with an
ellipsis (`` `'%...%'` `` for `` `'%${fullNameQuery}%'` ``), or one that
uses SQL-like syntax to describe a condition that was never actually
written (`` `status = 'pending'` `` when the code only has
`.eq("status", "pending")`). Both remain hard failures after this
update — a real run confirmed each is a plausible, defensible reading
of "the model is claiming this code exists," and excusing them would
require a fuzzier heuristic than a fixed marker/shape check, risking
excusing genuine fabrication elsewhere. See
`docs/agents/security-baseline-current.md`'s before/after addendum for
the full before/after accounting on a real run.

Separately, any matched (`matched_required`/`matched_optional`)
finding whose `evidence` is empty after trimming is flagged
**speculative** — tracked and penalized (§4.2), but not reclassified;
an empty quote is insufficient evidence, not false evidence, and
neither is a paraphrase with no backtick-quoted claim at all.

**Matching order (rules 3/4), against one ground-truth pool at a
time** (`scorer.ts`'s `pickMatch`):

1. **Exact `rule_id` match**, when the produced finding supplies a
   `ruleId`: look for the one entry in this pool whose own `rule_id`
   equals it exactly (schema-enforced unique within the fixture) — file
   and line are not checked at all on this path; a correct `rule_id` is
   trusted even if the cited line has drifted from the declared region.
   **If a `ruleId` was supplied but matches nothing in this pool, this
   pool yields no match — full stop.** The scorer does NOT fall through
   to step 2 for this finding: a wrong `rule_id` must never be silently
   accepted just because the file/line happens to coincide with some
   *other* entry. (It still may match a different, correct entry via
   `rule_id` in the *other* pool, or end up `prohibited`/
   `unsupported_extra` if it matches nothing anywhere.)
2. **Canonical category + file + line/region**, only when the produced
   finding supplied no `ruleId` at all: the file is in the entry's
   `files` (or, for a `repository_scope: true` entry, the finding's
   `file` is `null` — §3.7), and either the entry declares no
   `line_ranges` for that file (an "absence" finding, e.g. "no RLS
   policy exists" — file membership alone is enough) or the produced
   finding's line range overlaps the entry's declared range for that
   file — AND, ONLY IF this entry genuinely overlaps a sibling entry
   (§3.6, `findEntriesNeedingDisambiguation`), the produced finding's
   RAW category must equal the entry's declared `category` exactly. A
   produced finding with no line at all (`lineStart: null`, but a
   non-null `file`) can only match an entry with no line constraint.
3. **Compatibility category + file + line/region**, only if step 2
   found nothing at all in this pool: identical to step 2, except the
   category-equality test also accepts the finding's
   compatibility-normalized category (§3.6). This is the path that
   keeps **today's unmodified production reviewer** (which emits no
   `rule_id` and plain, unmigrated category strings) benchmarkable
   without any production change — and is reported distinctly from
   step 2 so a compatibility-layer save is visible, not silent (§4.5).
4. **Duplicate detection** (rule 5, orthogonal to which step found the
   entry): whichever step (1, 2, or 3) identifies the entry, if that
   entry was already consumed by an earlier produced finding in this
   same run, this finding is `duplicate` instead of a second true
   positive.

**Why "not in `allowed_categories`" defaults to `prohibited`, not
`unsupported_extra`:** the task's instruction to "be strict on false
positives" is implemented as a strict *whitelist*, not a blocklist —
`allowed_categories` is the one place a fixture author says "these
categories are even plausible here"; anything else is prohibited by
default, and `prohibited_categories` exists only to name the specific
traps a fixture is guarding against for a human reader, not to define
the actual boundary (the boundary is `allowed_categories`'s
complement).

### 4.1b Quality-narrative fields and standards citations (Task 2, new this pass)

`producedFindingSchema` also carries four new optional fields, none of
them consulted by `scoreFixture`'s scoring logic today (they exist so a
future pass can build the Deferred metrics in §1 without another schema
migration first):

- `securityConsequence`, `attackPreconditions`, `exploitScenario` — free
  text, mirroring the spec's §4 fields of the same name. Absent by
  default; never invented for adapted production output (`adapter.ts`).
- `standards` — zero-or-more `{ framework, id, version? }` citations.
  `framework` is one of `owasp-top10` | `owasp-api-top10` | `asvs` | `cwe`
  | `owasp-llm-top10` (`standardsFrameworkSchema`, `scorer.ts`) —
  **deliberately excludes `owasp-agentic-top10`** until the spec's own
  §1.6 verification gap on the `ASI01`–`ASI10` item list is resolved
  (see Task 7 / §11a below). `id` is validated against a per-framework
  format pattern (`STANDARDS_ID_PATTERNS`) — e.g. `"A01:2025"`,
  `"CWE-89"`, `"LLM01:2026"` — rejecting anything that doesn't match
  that shape at parse time. This is FORMAT validation only ("is this
  even a real-looking ID for this framework"), never a semantic "does
  this ID actually apply to this finding's category" check — that's
  §1's Deferred "standards-mapping accuracy" metric. Passing an empty
  array is itself rejected (`min(1)`) — a finding either omits the field
  (nothing supplied) or supplies at least one real citation; an empty
  array would ambiguously claim "checked, nothing applies," which the
  benchmark isn't yet positioned to assert.

### 4.2 Hard failure rules

Two conditions are disqualifying regardless of numerical score:
`hallucinated_path` and `fabricated_evidence`. A fixture with either
present anywhere has `normalized_score` forced to `0` and `passed:
false`, no matter how well it otherwise did — matching the spec's own
"never" language for hallucination (§5) and extending the same
standard to a fabricated quote (claiming code says something it
doesn't is the same class of invented information as citing a file
that doesn't exist).

**Conditions considered and deliberately NOT made hard failures:**
- **`prohibited` findings** (including a `safe`-fixture violation or an
  `ambiguous`-fixture overconfidence violation) — these are wrong
  judgment calls about *real* code (a real file, a real quoted line),
  not invented information. They already block `passed` (§4.3) and are
  heavily penalized; escalating to a hard failure would double-count
  the exact failure mode hallucination/fabrication exist to catch.
- **`unsupported_extra` findings** — same reasoning: a real category,
  a real citation, just not one the fixture asked for.
- **A malformed reviewer-result input** (wrong enum value, `lineEnd`
  set while `lineStart` is `null`, etc.) is rejected outright by
  `reviewerResultSchema`/`producedFindingSchema` before scoring even
  starts — this is an input-validation failure, not a scoring outcome,
  and is a different concept from a hard failure on an otherwise
  well-formed finding.

### 4.3 Per-fixture score and pass/fail

Per fixture, starting from `raw = 0`:

| Event | Score effect |
|---|---|
| Each `required_findings[]` entry matched by exactly one produced finding | `+1` |
| Each `required_findings[]` entry matched by zero produced findings | `−1`, **×2 if `severity_range` includes `P0`** |
| Each `duplicate` finding | `−0.3` |
| Each `prohibited` finding | `−1`, **×2 if the fixture is `safe`/`false_positive_trap`-tagged** (a false positive on code that's definitively safe is worse than one on code that's merely out of scope) |
| Each `unsupported_extra` finding | `−0.5` |
| Each `speculative` finding (empty evidence on an otherwise-matched finding) | `−0.5`, in addition to any other applicable rule |
| A matched *required* finding's severity above `severity_range.max` | `−0.5` per level of inflation |
| A matched *required* finding's severity below `severity_range.min` | `−0.25` per level of understatement (optional matches are excluded from both severity rules — deliberately: an optional finding was never mandatory, so its calibration isn't scored the same way a required one's is) |
| Fixture is `safe`/`false_positive_trap`/`ambiguous`-tagged, and would otherwise pass ignoring the (always-empty, for these tags) required-findings check | `+1` — correctly recognizing "no confident, well-evidenced vulnerability exists here" is itself a scored positive, applied uniformly to both archetypes rather than as two separately-special-cased rules |
| `matched_optional` (matching an `optional_findings[]` entry) | `0` — tracked (`optional_findings_accepted`), never scored either way |
| `insufficient_evidence` (Task 1/5 — `evidenceState: "needs_more_context"`) | `0` directly, but never contributes the `+1` "matched" credit either — if this was the only produced finding for a `required_findings[]` entry, that entry is scored as a normal miss under the first row above, not as a partial match. See §4.1a. |

`max_possible = required_findings.length + (1 if safe/false_positive_trap/ambiguous else 0)`,
`min_possible = −5`. `normalized_score = 0` on a hard failure, else
`clamp((raw − min_possible) / (max_possible − min_possible), 0, 1)`.

**`passed`** is a separate, strict boolean — not a numeric threshold on
`normalized_score` — deliberately, so "a fixture that scores
reasonably well" and "a fixture with zero disqualifying defects" can't
be confused:

```
passed = !hard_failure
      && required_findings_missed.length === 0
      && prohibited_findings.length === 0
      && unsupported_extra.length === 0
```

Duplicates alone don't block `passed` (the reviewer *did* correctly
identify the vulnerability, just redundantly) — they still cost points.

### 4.4 Suite-level (aggregate) metrics

Computed by `aggregateScores()` across every fixture in a run. Ratios
whose denominator is `0` (nothing produced, or nothing required) are
reported as `1` for precision/recall-shaped metrics and `0` for
rate-shaped metrics — a vacuous "no false claims made"/"nothing to
find" is treated as correct, not as `NaN`.

| Metric | Definition |
|---|---|
| **Precision** | `(matched_required + matched_optional) / total_produced_findings` |
| **Recall** | `total_required_matched / total_required_findings` (suite-wide; `optional_findings` have no recall expectation — they're never required) |
| **P0 recall / P1 recall** | Same as recall, restricted to `required_findings[]` entries whose `severity_range` includes `P0` (respectively `P1`) |
| **False-positive rate** | `(prohibited + unsupported_extra) / total_produced_findings` |
| **Hallucination rate** | `hallucinated_path / total_produced_findings` |
| **Speculative-finding rate** | `speculative / total_produced_findings` |
| **Duplicate rate** | `duplicate / total_produced_findings` |
| **Severity accuracy** | `matched_required findings within severity_range / all matched_required findings` |
| **Confidence calibration** | Every produced finding contributes one `(confidence, correct)` data point (`correct` = `matched_required`/`matched_optional`/`duplicate`); bucketed by `high`/`medium`/`low`, reported as each bucket's correctness rate. A well-calibrated reviewer's buckets should be *monotonically* decreasing — a suite where `low`-confidence findings are *more* often correct than `high`-confidence ones means the confidence field is meaningless, which is itself worth reporting even without a single "score." |
| **`by_domain` / `by_tag`** | Average `normalized_score`, grouped — matters more than one suite-wide number for actually improving the reviewer; a regression hidden inside one domain's average is exactly what an aggregate-only number would miss. |
| **`failed_fixtures`** | Fixture ids with a hard failure — worth gating CI on independently of the aggregate score, given §5's "never" framing in the spec. |

### 4.5 Compatibility report — diagnosing a scored run

`FixtureScore.allFindings` carries every produced finding's full
`ClassifiedFinding` (not just the ones sorted into the summary
buckets), and `buildCompatibilityReport(score)` flattens it into one
row per produced finding:

```ts
interface CompatibilityReportRow {
  index: number;                 // position in the reviewer's findings array
  file: string | null;
  originalCategory: string;      // exactly what the reviewer said — never altered
  normalizedCategory: string | undefined; // category-compat.ts's mapping, if any
  classification: FindingClassification;  // one of the 7 buckets (§4.1)
  matchedId: string | null;      // which ground-truth entry, if any
  matchMethod: "rule_id" | "canonical_category_location" | "compatibility_category_location" | "unmatched";
  compatibilityApplied: boolean; // did the compatibility layer change the outcome?
}
```

This is what makes a benchmark failure diagnosable at a glance,
instead of requiring a human to dig through `FixtureScore`'s separate
classification-bucket arrays by hand: "was this a real miss, or just a
category-labeling mismatch the compatibility layer should have bridged
but didn't?" is answerable directly from one row. `compatibilityApplied`
is `true` when either the match itself only succeeded via step 3 of
§4.1's matching order, or the raw category alone would have produced a
DIFFERENT allowed/prohibited outcome than the normalized one did.

## 5. Benchmark Execution Design

### 5.1 Directory layout

```
tests/security-benchmarks/
  README.md                      # how to run the suite, schema version, scoring script entry point
  _schema/
    expected.schema.json          # JSON Schema for §3's manifest shape — every fixture validated against this in CI
  access-control/
    01-idor-service-role-no-owner-check/
      expected.json
      fixture/
        src/route.ts
        src/lib/data-access.ts
      explanation.md              # optional — longer human rationale, not read by the scorer
    02-bfla-admin-action-exposed/
      ...
  auth/
  injection/
  browser-web/
  ssrf-file/
  secrets-crypto/
  api-security/
  multi-tenant/
  webhooks/
  database/
  concurrency/
  supply-chain/
  ci-cd/
  logging-privacy/
  exceptional-condition/
  business-logic/
  llm-ai/
```

Each domain folder name matches a §3 section of the spec 1:1 (e.g.
`multi-tenant/` = §3.8) so a contributor adding coverage for a spec
section always has one unambiguous place to put it.

### 5.2 Fixture contents

Per fixture directory:
- **`fixture/`** — the minimal source files a reviewer actually reviews
  (real TypeScript/SQL/YAML, syntactically valid, small — a fixture
  should be the smallest snippet that genuinely exercises the pattern,
  not a full working app; ShipSafe's own code is the reference style for
  what "real" looks like, not a toy example that wouldn't compile).
- **`expected.json`** — the §3 manifest. Validated against
  `_schema/expected.schema.json` in CI before any scoring run, so a
  malformed fixture fails fast with a schema error, not a confusing
  scoring anomaly.
- **`explanation.md`** (optional) — free-form human rationale: why this
  fixture is shaped the way it is, what real-world case it's modeled
  on, what mistake it's designed to catch. Never consumed by the scorer;
  purely for the next person maintaining the suite.

### 5.3 Execution flow

1. A harness reads every `expected.json`, validates it against the
   schema, and builds a `ReviewContext`-shaped input from each fixture's
   `fixture/` files (matching the actual production `ReviewContext`
   shape the real Security Reviewer consumes — same input contract for
   the benchmark as for production, so results predict production
   behavior).
2. The Security Reviewer (whatever version/prompt/model is under test)
   runs against each fixture independently — fixtures must not leak
   context to each other (no shared conversation, no accumulated state
   across fixtures) or a later fixture's score would depend on run
   order.
3. Each fixture's produced findings are scored per §4.2 against its
   `expected.json`.
4. Suite-level metrics (§4.3) are computed across all fixture results.
5. The aggregate report (§4.4) is written; CI can gate on
   `suite_score` and/or `hallucination_rate`/`failed_fixtures` (a single
   hallucination should probably block merge on its own, independent of
   the aggregate score, given §5's "never" framing in the spec).

### 5.4 What this plan deliberately does NOT specify yet

- The actual harness implementation (language/runner) — this is a data
  design document, not the harness code.
- Whether the harness calls the real Anthropic-backed provider or a
  cheaper/deterministic stand-in for fast iteration — likely both (a
  fast mock-provider-style pass for every commit, a real-model pass
  before a release), but that's an implementation decision for whoever
  builds the harness, not fixed here.
- Statistical significance / flakiness handling for a non-deterministic
  model backend (e.g. running each fixture N times and requiring a
  pass rate rather than a single pass/fail) — flagged as a real design
  gap, not silently assumed away.
- **RESOLVED — the mapping from a real reviewer run to `scorer.ts`'s
  `ReviewerResult` input.** Originally flagged here as unresolved;
  implemented as `src/server/security-benchmarks/adapter.ts`'s
  `adaptPersistedFindings()` (persisted `Finding[]` → `ReviewerResult`,
  severity/confidence normalization per §3.4/§3.5).
- **RESOLVED — the `fabricated_evidence` false-positive risk against
  free-prose `description` text.** Originally flagged here: since
  `description` is prose, not a guaranteed verbatim quote, the
  original substring-based check risked flagging real, legitimate
  findings whose description paraphrases rather than quotes the code.
  Fixed by the §4.1 fabrication redesign — only backtick-quoted spans
  are ever checked; pure paraphrase is never flagged, however
  different its wording is from the source.
- **RESOLVED — `filePath: null` support.** Originally the adapter
  refused it outright. Audited against the actual code
  (`providers/prompt.ts`'s system prompt, `providerFindingSchema`,
  `anthropic-provider.ts`'s own null-exempt hallucination check) and
  confirmed this is real, currently-active production behavior, not a
  hypothetical — fixed via `repository_scope` ground-truth entries and
  a nullable `producedFindingSchema.file` (§3.7).
- **Still open — production has no concept of the spec's §4.4
  `needs_more_context` status object at all.** The adapter always sets
  `needsMoreContext: false`, and the scorer never reads that field
  regardless (§3.8) — so this doesn't penalize production, but it does
  mean an `ambiguous` fixture can currently only ever be judged on
  "zero findings vs. a finding" (or a low-confidence optional match)
  against real production output, never on an explicit
  needs-more-context signal, until production implements one. Not
  fixable from the benchmark side alone.

## 6. Phase 1 Benchmark Set — 40 Fixtures

Not implemented yet — names, domain, tags, and what each tests, per the
task. Numbered `P1-01` through `P1-40`. Every one of the 17 spec domains
(§3.1–§3.17) has at least one fixture; the archetype tags in §2
(`ambiguous`, `false_positive_trap`, `multi_file`, `concurrency`) are
each represented multiple times, not as a token single example.

| # | Fixture ID | Domain | Tags | What it tests |
|---|---|---|---|---|
| 1 | `access-control-01-idor-service-role-no-owner-check` | access-control | vulnerable, multi_file | A route handler and a shared, unguarded data-access helper in a second file — the missing ownership check is one root cause reachable from the route; also exercises §4.3 merge behavior if a second call site is added later. |
| 2 | `access-control-02-bfla-admin-action-exposed` | access-control | vulnerable | An admin-only mutation missing its role check on a route that's a near-duplicate of an already-correctly-guarded sibling route. |
| 3 | `access-control-03-safe-rls-scoped-read` | access-control | safe | A user-session Supabase client with no client-side filter, relying entirely on RLS — must not be flagged as "missing an ownership check." |
| 4 | `access-control-04-fp-trap-service-role-in-trusted-worker` | access-control | false_positive_trap | Service-role client used inside a background worker processing an already-signature-verified, already-claimed queue row — correct usage per §3.1's false-positive note. |
| 5 | `auth-01-session-fixation-no-rotation` | auth | vulnerable | Session identifier not rotated after a successful login. |
| 6 | `auth-02-predictable-password-reset-token` | auth | vulnerable | Password-reset token generated with `Math.random()` instead of a CSPRNG. |
| 7 | `auth-03-safe-managed-auth-provider` | auth | safe | Password handling fully delegated to a managed auth provider (Supabase Auth) — must not be flagged as "passwords not hashed" with no evidence the app touches raw passwords. |
| 8 | `injection-01-sql-string-concatenation` | injection | vulnerable | A raw SQL string built via template-literal interpolation of a request parameter. |
| 9 | `injection-02-os-command-injection-exec` | injection | vulnerable | `exec()` invoked with a shell string built from an untrusted PR branch name. |
| 10 | `injection-03-safe-parameterized-query-builder` | injection | safe | A query-builder `.eq()` call that reads like string building but is actually parameterized — must not be flagged. |
| 11 | `browser-web-01-xss-dangerously-set-inner-html` | browser-web | vulnerable | PR description text rendered via `dangerouslySetInnerHTML` with no sanitization. |
| 12 | `browser-web-02-cors-wildcard-with-credentials` | browser-web | vulnerable | `Access-Control-Allow-Origin: *` combined with `Access-Control-Allow-Credentials: true`. |
| 13 | `browser-web-03-safe-jsx-text-interpolation` | browser-web | safe | Plain `{value}` JSX interpolation of untrusted content — auto-escaped by React; must not be flagged as XSS. |
| 14 | `ssrf-file-01-ssrf-unbounded-server-fetch` | ssrf-file | vulnerable | A server-side `fetch()` whose target URL is entirely attacker-controlled, no host allow-list. |
| 15 | `ssrf-file-02-path-traversal-upload-filename` | ssrf-file | vulnerable | A file write using a client-supplied filename verbatim, no `path.basename`/root check. |
| 16 | `ssrf-file-03-fp-trap-hardcoded-host-interpolated-path` | ssrf-file | false_positive_trap | `fetch(\`https://api.github.com/repos/${owner}/${repo}\`)` — hardcoded trusted host, only a path segment interpolated; must not be flagged as SSRF. |
| 17 | `secrets-crypto-01-hardcoded-live-api-key` | secrets-crypto | vulnerable | A literal, live-looking API key committed as a string constant. |
| 18 | `secrets-crypto-02-insecure-random-security-token` | secrets-crypto | vulnerable | `Math.random()` used to generate a security-relevant token. |
| 19 | `api-security-01-mass-assignment-update-request-body` | api-security | vulnerable | `update(req.body)` against a table with a security-relevant column (e.g. `role`) the client shouldn't be able to set. |
| 20 | `api-security-02-no-bound-expensive-provider-call` | api-security | vulnerable | An endpoint triggering AI-provider calls with no rate limit or per-request cost bound. |
| 21 | `api-security-03-safe-explicit-field-allowlist` | api-security | safe | A write path that only ever constructs its update object from an explicit, validated field list — must not be flagged as mass assignment just because a whole object is passed downstream. |
| 22 | `multi-tenant-01-tenant-id-trusted-from-request-body` | multi-tenant | vulnerable | A query scoped by `req.body.workspaceId` instead of the session-derived workspace. |
| 23 | `multi-tenant-02-security-definer-no-internal-check` | multi-tenant | vulnerable | A `SECURITY DEFINER` SQL function that performs a cross-tenant-relevant write with no internal caller/tenant validation. |
| 24 | `multi-tenant-03-safe-rls-named-helper-function` | multi-tenant | safe | An RLS policy calling a named `is_workspace_member()`-style helper — must not be flagged as an ad hoc/unsafe condition. |
| 25 | `multi-tenant-04-ambiguous-security-definer-no-callsite` | multi-tenant | ambiguous | A `SECURITY DEFINER` function with no internal check, but no call site included in the fixture to confirm it's actually reachable from `authenticated` — correct answer is `needs_more_context`, not a confident P0. |
| 26 | `webhooks-01-no-signature-verification` | webhooks | vulnerable | A webhook handler that parses and acts on the payload before ever checking its signature. |
| 27 | `webhooks-02-non-timing-safe-signature-compare` | webhooks | vulnerable | Signature compared with `===` instead of a timing-safe comparison, with no length pre-check. |
| 28 | `webhooks-03-safe-verified-then-idempotent` | webhooks | safe | Verify signature → check delivery-id idempotency → process, matching ShipSafe's own route handler — must not be flagged. |
| 29 | `database-01-rls-never-enabled-on-tenant-table` | database | vulnerable | A migration creates a new tenant-scoped table and never runs `ENABLE ROW LEVEL SECURITY` on it. |
| 30 | `database-02-fp-trap-rls-enabled-zero-policies-service-role-only` | database | false_positive_trap | RLS enabled with deliberately zero policies on a genuinely service-role-only table (the correct deny-all-for-`authenticated` pattern) — must not be flagged as "policies missing." |
| 31 | `concurrency-01-toctou-select-then-update-job-claim` | concurrency | vulnerable, concurrency | A "claim next job" implementation as a separate `SELECT` then `UPDATE`, with the `UPDATE`'s `WHERE` clause not re-checking the eligibility condition — classic TOCTOU. |
| 32 | `concurrency-02-safe-atomic-conditional-claim` | concurrency | safe, concurrency | A CAS-style `UPDATE ... WHERE` that re-checks eligibility at update time, matching ShipSafe's `claimNextPendingReview` — must not be flagged even without an explicit row lock. |
| 33 | `supply-chain-01-postinstall-remote-script-execution` | supply-chain | vulnerable | A `package.json` `postinstall` script that pipes a downloaded remote script into a shell. |
| 34 | `ci-cd-01-pull-request-target-with-fork-head-checkout` | ci-cd | vulnerable | A workflow on `pull_request_target` that checks out and builds/tests the PR's own head ref — hands fork code access to base-repo secrets. |
| 35 | `logging-privacy-01-plaintext-password-in-log-context` | logging-privacy | vulnerable | A `logger.error(...)` call whose context object includes a raw password field. |
| 36 | `exceptional-condition-01-fail-open-signature-catch` | exceptional-condition | vulnerable | A `try/catch` around signature verification whose `catch` branch allows processing to continue instead of denying. |
| 37 | `exceptional-condition-02-safe-fail-closed-required-reviewer-check` | exceptional-condition | safe | A required-check-failure path that defaults to a deny/fail-closed result before any later step can run, matching `ReviewOrchestrator`'s fail-closed design — must not be flagged as "missing a fallback." |
| 38 | `business-logic-01-ambiguous-workflow-transition-not-shown` | business-logic | ambiguous | An endpoint that sets a workflow's state directly, with no visible transition-table check in the fixture — plausible bypass, but the state-machine enforcement might live in a DB constraint/trigger not included; correct answer is `needs_more_context`. |
| 39 | `llm-ai-01-prompt-injection-no-delimiter` | llm-ai | vulnerable | Untrusted diff text concatenated directly into a model prompt string with no delimiter or "treat as data" instruction. |
| 40 | `llm-ai-02-safe-delimited-and-cross-validated` | llm-ai | safe | Untrusted content wrapped in explicit delimiters with an explicit system-prompt instruction, and structured output cross-checked against the real file list before being trusted — matches ShipSafe's own `providers/prompt.ts` + `anthropic-provider.ts` pattern; must not be flagged. |

### 6.1 Coverage check against §2's archetype tags

- `vulnerable`: 24 fixtures.
- `safe`: 10 fixtures.
- `ambiguous`: 2 (#25, #38).
- `false_positive_trap`: 3 (#4, #16, #30).
- `multi_file`: 1 explicit (#1) — **acknowledged gap**, see §6.2.
- `concurrency`: 2 (#31, #32), both in the dedicated `concurrency` domain.

### 6.2 Known Phase 1 gaps (by design, not oversight)

- **`multi_file` is under-represented** (1 of 40). Phase 1 prioritizes
  domain breadth (all 17 original sections represented — now 18 with
  §3.18, see below) over deep coverage of every archetype tag; Phase 2
  should add multi-file variants specifically for the domains where
  cross-file root causes are most realistic (access-control,
  multi-tenant, business-logic).
- **LLM/AI-specific coverage is thin relative to the spec's expanded
  taxonomy — UPDATED after the 2026-09-19 standards refresh.** §3.17 of
  the spec covers ten LLM01–LLM10 categories in depth, now on the 2026
  numbering (§3.17's own IDs shifted — see the spec's §1.5); Phase 1's
  2 fixtures for this domain (#39, #40) map to LLM01:2026 Prompt
  Injection and its safe counterpart only. None of sensitive-information
  -disclosure, supply-chain, poisoning, unbounded-consumption,
  misinformation, or hidden-context-exposure (LLM02/04/05/06/07/08:2026)
  has a dedicated fixture yet. **New gap, not present before this
  refresh: §3.18 Agentic AI Security (23 items) has ZERO fixture
  coverage in Phase 1 — it didn't exist when the 40-fixture list was
  designed.** See §9 of this plan (Standards Refresh Audit) for the
  detailed accounting of which of the current 10 implemented fixtures
  are affected and what's proposed, not yet applied.
- **`false_positive_trap` coverage (3 of 40) is thin relative to how
  central false-positive avoidance is to the spec's own §5 anti-patterns.**
  Every domain's §3 subsection lists 2–4 "common false positives" in the
  spec; Phase 1 tests 3 of them directly. This is the single highest-value
  area to expand in Phase 2, since false positives are cheaper to
  generate (any "looks vulnerable but isn't" snippet works) and directly
  measure the specific failure mode this whole spec exists to prevent.
- **No fixture explicitly tests severity-range boundaries** (a finding
  correctly identified but scored specifically for being one severity
  level too high/low) — Phase 1 fixtures mostly have a single-value
  `severity_range` (e.g. `["P0","P0"]`) rather than a deliberately wide
  range designed to catch subtle miscalibration. Worth 3–5 dedicated
  fixtures in Phase 2.
- **No fixture yet targets confidence calibration specifically** (a
  fixture engineered so a well-calibrated reviewer *should* answer with
  `low` confidence, to check the reviewer doesn't default to `high` out
  of habit) — every Phase 1 `vulnerable` fixture is designed to be
  clear-cut. Phase 2 should add a handful of genuinely hard-to-be-certain-
  about cases (distinct from `ambiguous`, which tests "insufficient
  evidence → no finding" — this would test "sufficient evidence for a
  finding, but real residual uncertainty → correctly low confidence").

## 7. Pre-Production Acceptance Bar

**New this refresh.** A strict gate a Security Reviewer v2 candidate
must clear before it's used for real, unreviewed PR decisions — not a
target to tune toward, a bar to fail against. Per-metric definitions
are §1's table; this section says which ones actually block release,
and at what threshold. Thresholds below are deliberately NOT chosen to
make an early candidate pass easily — expect a first real run to fail
several of these, and treat that as the benchmark doing its job, not as
a benchmark bug to loosen.

### 7.1 Must-pass (any single failure blocks release, full stop)

| Requirement | Threshold | Why zero-tolerance |
|---|---|---|
| Hallucinated-path rate | **= 0** across the full suite | Spec §5's own "never" language — a single hallucinated file/line means the reviewer cannot be trusted to only claim what it actually saw. |
| Fabricated-evidence rate | **= 0** across the full suite | Same bar as hallucination (spec §4.1's redesign treats these as the same class of hard failure) — a fabricated quote is invented information, not a judgment call. |
| Safe-code false-positive rate | **= 0** across every `safe`/`false_positive_trap` fixture | A reviewer that flags code the fixture author has certified safe cannot be trusted on code that ISN'T certified safe either — this is the single most direct measure of over-triggering. |
| Ambiguous-case overclaim rate | **= 0** across every `ambiguous` fixture | Per spec §4.1's evidence-state rule: a confident finding where the evidence only supports `needs_more_context` is a severity-inflation failure by construction, not a borderline call. |
| P0/P1 recall | **≥ 95%** | Missing a critical, clearly-evidenced vulnerability is the failure mode that actually hurts users if this reviewer is trusted for real PR decisions — set high deliberately, not at a number chosen to make an early run pass. |
| Severity inflation on `ambiguous`-tagged fixtures | **= 0** instances | Distinct from, and in addition to, the overclaim-rate row above: even a LOW-confidence finding on an ambiguous fixture must not carry inflated severity (P0/P1) — see spec §4.1's `evidence_state` + severity pairing rule. |
| Valid exploit path on every confirmed P0/P1 finding | **100%**, enforced **manually** until §1's Deferred metrics are implemented | This is a must-pass REQUIREMENT, not a must-pass MEASUREMENT — see §7.3. The benchmark cannot yet check this mechanically (§1's "Exploit-path validity" row is `Deferred`), so until the schema/scoring work lands, every P0/P1 finding from a benchmark run must be manually spot-checked against spec §2.1's source→boundary→sink→impact chain before the run counts toward a release decision. This is a real, temporary, explicitly-acknowledged gap in automation — not a silently-skipped requirement. |

### 7.2 Target (tracked, expected to improve over time, not release-blocking on its own)

| Requirement | Target | Notes |
|---|---|---|
| Overall recall | ≥ 85% | Lower priority than P0/P1 recall specifically — a missed Nit is not the same risk as a missed P0. |
| Precision | ≥ 80% | Informational per §1, but a sustained miss here should prompt investigation even though it doesn't block a single release. |
| Confidence calibration monotonicity | `high` bucket correctness > `medium` > `low`, strictly | A violation (e.g. `low`-confidence findings MORE often correct than `high`) means the confidence field is meaningless — worth investigating even though no single fixture fails for it. |
| Duplicate root-cause rate | ≤ 5% | Spec §4.3's "one root cause, one finding" rule — occasional slips tracked, not zero-tolerance the way hallucination is. |
| Standards-mapping accuracy / remediation quality | No numeric target yet | **Deferred** per §1 — cannot be measured until the schema extension lands; listed here as a placeholder so it isn't forgotten once it becomes measurable. |

### 7.3 Non-gating diagnostics (reported, never blocks release)

`by_domain`/`by_tag` score breakdowns, classification-bucket counts
(`matched_required`/`matched_optional`/`duplicate`/`prohibited`/
`unsupported_extra`), the full compatibility report (§4.5) for every
fixture in the run, and severity-understatement counts (as opposed to
inflation, which is gating on `ambiguous` fixtures per §7.1) — these
exist to make a failure diagnosable, not to gate on their own.

**On §7.1's manual exploit-path check specifically:** this is the one
must-pass row this plan cannot yet enforce automatically, and it's
listed as must-pass anyway rather than downgraded to "target" — the
alternative (silently dropping a genuinely load-bearing requirement
because the tooling isn't there yet) is exactly the kind of gap this
whole refresh exists to surface, not paper over. Automating it is the
highest-priority follow-up to this plan (§1's Deferred-metric schema
work).

## 8. Versioning

**Updated 2026-09-19 (Tasks 3/4 — reproducibility hardening pass).** A
benchmark run's result is only meaningful if it's reproducible and
attributable to a specific state of five independent things that can
each change on their own schedule. Both real gaps this section
previously flagged (no `BENCHMARK_SCHEMA_VERSION` constant, no reviewer
prompt version) are now addressed with explicit, hand-bumped constants
— see `src/server/security-benchmarks/versions.ts` for the
implementation and the doc comment on every constant explaining its own
bump policy:

| Version | What it identifies | Where it's tracked | Current value |
|---|---|---|---|
| **Security taxonomy version** | The exact state of `docs/agents/security-reviewer-v2.md`'s §1 standards baseline + §3 domain list together. | `versions.ts`'s `SECURITY_TAXONOMY_VERSION` — mirrors the spec's own header (`Taxonomy version:` line). | `2026.09.19` |
| **Benchmark schema version** | The exact shape of `expected.json` (`schema.ts`'s `expectedFixtureSchema`) and the scorer's classification/matching logic (`scorer.ts`). | `versions.ts`'s `BENCHMARK_SCHEMA_VERSION` — semver, bump policy documented on the constant itself (patch/minor/major per the doc comment). | `1.0.0` (first tracked value — not a resumption of prior, untracked numbering) |
| **Benchmark dataset version** | Which fixtures exist and in what state — `tests/security-benchmarks/`'s content. | `versions.ts`'s `BENCHMARK_DATASET_VERSION` — a hand-bumped human-readable label, deliberately NOT a git SHA (see the constant's own doc comment for why version constants must never derive from git/timestamp state). Per-run git-commit tracking, if a harness wants it, belongs in `run-metadata.ts` as run-specific data, not here. | `"phase1-10-of-40"` |
| **Reviewer prompt/version** | The exact prompt/instructions the reviewer under test was given. | `versions.ts`'s `REVIEWER_PROMPT_VERSION` — an explicitly-labeled PLACEHOLDER (derived from `SECURITY_TAXONOMY_VERSION`, the closest real hand-bumped identifier that exists), since `src/server/review-engine/providers/prompt.ts` still has no version string of its own. Replace this constant's definition the day that changes — do not keep deriving it from the taxonomy version once a real prompt version exists. | `"untracked-uses-taxonomy-2026.09.19"` |
| **Provider/model used, plus run parameters** | Which model actually generated the benchmarked output, and under what call parameters (Task 4). | `run-metadata.ts`'s `benchmarkRunMetadataSchema`/`BenchmarkRunMetadata` — `provider`, `model`, optional `temperature`/`thinkingMode`/`maxTokens`, required `concurrency`/`timeoutMs`, the four versions above (via `currentBenchmarkVersions()`), and `runTimestamp` (ISO 8601 — the one field in this whole module that IS a timestamp, since it records when a specific run happened, not what version the benchmark's design is). **Never includes a credential** — see that module's own doc comment; a harness with an API key in scope must not put it in this object. | N/A until a harness exists to populate it |

**Required benchmark report header** — `report.ts`'s
`buildBenchmarkReport(scores, metadata)` is the concrete implementation
of this section's contract: it stamps the `BenchmarkRunMetadata` a
harness passes in (which itself carries all four version constants via
`currentBenchmarkVersions()`) alongside `aggregateScores()`'s suite
metrics, `computeDeferredMetrics()`'s Deferred-metric results (§1), and
a run-wide compatibility report (§4.5, one row per produced finding
across every fixture). A `BenchmarkReport` therefore always carries:

```ts
{
  metadata: BenchmarkRunMetadata,   // provider/model/params + all 4 version constants + runTimestamp
  suite: SuiteMetrics,               // §4.4, now including evidenceState coverage (§4.1a)
  deferredMetrics: DeferredMetrics,  // §1's Deferred metrics — always "not_measurable" today, never fabricated
  compatibility: Array<{ fixtureId: string } & CompatibilityReportRow>,  // §4.5, run-wide
}
```

A report missing `metadata` (or missing any of `metadata.versions`'
four fields) is not reproducible and should not be used for an
acceptance-bar (§7) decision. **Still not implemented**: the harness
itself (§5.4) — `buildBenchmarkReport` assembles a report FROM already-
scored fixtures and caller-supplied metadata; it does not run a
reviewer or collect `provider`/`model`/timing information on its own.

## 9. Standards Refresh Audit (2026-09-19)

**Scope:** the 10 fixtures currently implemented under
`tests/security-benchmarks/`, audited against the spec's 2026-09-19
refresh (new LLM Top 10 numbering, new §3.18 Agentic AI Security, new
§2.1 threat-model chain, new §4 evidence model). Per the task this audit
was requested under: **nothing below has been applied to any fixture
file. Every item is a proposed change, reported for confirmation
first.**

### 9.1 Fixtures now incorrectly categorized

**None.** Every fixture's `category`/`allowed_categories`/
`prohibited_categories` values are canonical `domain.subcategory`
strings (§3.3), not numeric standard IDs — so the LLM Top 10's
2025→2026 renumbering (spec §1.5) doesn't invalidate any of them
structurally. One fixture's human-readable prose does cite a
now-stale numeric id (see §9.2) — that's a documentation staleness
issue, not a mis-categorization.

### 9.2 Missing or stale agentic/LLM mapping

- **`llm-ai-01-prompt-injection-unsafe-tool-use`'s `explanation` field
  cites "LLM06 Excessive Agency."** Under the spec's 2026 renumbering
  (§1.5), Excessive Agency is now **LLM03:2026**, not LLM06 — LLM06:2026
  is now Unbounded Consumption, an unrelated category. **Proposed:**
  update the `explanation` string's citation from "LLM06 Excessive
  Agency" to "LLM03:2026 Excessive Agency." This is a pure prose/citation
  correction — `explanation` is documentation only, never read by the
  scorer (`load-fixtures.ts`), so this change cannot affect scoring
  behavior; it's still reported here rather than silently fixed, per
  the task's instruction.
- **`llm-ai-01`'s `req-2` (the unvalidated-file-write / auto-fix finding)
  now has a second, arguably more precise home in §3.18's new agentic
  taxonomy** — specifically items 1 (excessive agency, systemic tool
  scoping) and 14 (missing human approval gates, since the fixture's
  hypothetical auto-fix applies changes with no review step). **Proposed:**
  once §3.18 fixtures exist (Phase 2), consider whether `req-2`'s
  `category`/`rule_id` should gain a secondary agentic-domain
  cross-reference, or whether a NEW, dedicated §3.18 fixture should
  test items 1/14 directly instead (probably the better choice — this
  fixture's own primary purpose, testing LLM01:2026 + LLM03:2026
  together, stays clean if item 1/14 coverage is a separate fixture
  rather than retrofitted onto this one). No change proposed to this
  fixture itself beyond §9.2's citation fix above.
- **No fixture tests any of §3.18's 23 items directly.** Not a
  miscategorization of an existing fixture — a coverage gap, already
  noted in §6.2. Restated here because it's the most consequential
  single finding of this audit: **the benchmark currently cannot
  measure the Security Reviewer against ANY of the agentic-security
  taxonomy this refresh just added.**

### 9.3 Ground-truth expectations that should change

**None of the 10 fixtures' existing `severity_range`/`confidence_range`
values conflict with the new evidence-state pairing rule** (spec
§4.1: P0/P1 requires `proven`/`strongly_supported`; `strongly_supported`
pairs with confidence ≤ `medium`). Checked individually:

| Fixture | Implicit evidence state | Consistent with existing confidence_range? |
|---|---|---|
| `access-control-01` | `proven` (full chain visible in ~7 lines) | Yes — `["medium","high"]` allows `high`, correctly. |
| `database-01` | `proven` | Yes — `["medium","high"]`. |
| `injection-01` | `proven` | Yes — `["high","high"]`. |
| `webhooks-01` (req-1, opt-1) | `proven` (both — handler fully visible) | Yes. |
| `concurrency-01` | `proven` (race structurally visible, no external call site needed) | Yes — `["medium","high"]`. |
| `secrets-crypto-01` | `proven` | Yes — `["high","high"]`. |
| `multi-tenant-04` (opt-1) | **`strongly_supported`** — this fixture IS the spec's own §9 Example B | Yes, and more conservative than required: `["low","low"]` vs. the rule's actual ceiling of `medium`. |
| `llm-ai-01` (req-1, req-2) | `proven` (both fully visible in one ~26-line function) | Yes — `["medium","high"]` both. |

**No numeric threshold needs to change.** The one real, universal gap
(§9.4) is structural, not a wrong number anywhere.

### 9.4 Benchmark rules that conflict with the updated evidence model

**PARTIALLY RESOLVED 2026-09-19 (Tasks 1/5 hardening pass).** This
section originally found: `groundTruthFindingSchema` (`schema.ts`) and
`producedFindingSchema` (`scorer.ts`) had no `evidence_state` field at
all — the spec's three-state model (`proven`/`strongly_supported`/
`needs_more_context`, §4.1) had no representation anywhere in the
benchmark's data model, ground truth or produced side.

**What's now fixed, on the PRODUCED side only:**
`producedFindingSchema.evidenceState` exists (§4.1a above), and
`scoreFixture` enforces "`needs_more_context` must never be treated as
a confirmed vulnerability" structurally via the new
`insufficient_evidence` classification — this closes the exact gap this
section originally flagged as unenforced ("a `strongly_supported`/
`needs_more_context` finding asserted with unjustified confidence" is
now caught for the `needs_more_context` case specifically; see the
paragraph below for what's still open).

**What's still open, unchanged from the original finding:**
- **`groundTruthFindingSchema` still has no `evidence_state` field.**
  The benchmark still cannot distinguish "this fixture's required
  finding should be `proven`" from "...should be `strongly_supported`"
  as MACHINE-CHECKED ground truth — §9.3's table above remains this
  document's own manual analysis, not something `expected.json` encodes
  or the scorer checks against. See §9.6 (Task 8 audit) below for the
  proposed per-fixture values this would need, reported rather than
  applied.
- **The `proven`-only-pairs-with-any-confidence /
  `strongly_supported`-pairs-with-≤`medium` pairing rule (spec §4.1,
  distinct from the `needs_more_context` gate) is still not enforced.**
  A `strongly_supported` finding asserted at `confidence: "high"` on a
  NON-ambiguous, `vulnerable`-tagged fixture is not currently flagged —
  only the `needs_more_context` case (Task 1's explicit scope) was
  addressed this pass. Confirmed, scoped follow-up, not implemented
  here: adding this would require ground truth to declare an expected
  `evidence_state` too (see the point above), since the rule is about
  whether a PRODUCED claim's confidence is proportionate to its OWN
  stated evidence state, not about matching a ground-truth expectation
  — it could technically be added without a ground-truth field, purely
  as a self-consistency check on the produced finding, and is flagged
  here as the highest-value next increment to this section specifically.

### 9.5 Summary

Of the 10 implemented fixtures: **0 require a vulnerability-intent
change, 0 require a severity/confidence-range change, 1 has a stale
prose citation** (§9.2, cosmetic, non-scoring), and **all 10** were
affected by the same one structural gap (§9.4, the missing
`evidence_state` field) — which is a benchmark-infrastructure gap, not
a fixture-authoring mistake. **Updated 2026-09-19:** the PRODUCED-side
half of §9.4's gap is now closed (Tasks 1/5); the highest-value next
steps are now: (1) fix the one stale citation per §9.2 (still open,
cosmetic), (2) decide on §9.6's proposed per-fixture `evidence_state`
ground-truth values (reported, not applied), (3) build the first §3.18
agentic fixtures once Phase 2 fixture work resumes.

### 9.6 Task 8 audit — proposed fixture-metadata additions (reported, NOT applied)

**Per this pass's explicit instruction, nothing below has been written
into any `expected.json` file.** This re-audits the same 10 fixtures
listed in §9.1–9.4 for whether their metadata should gain: an expected
`evidence_state`, an optional standards mapping, exploit preconditions,
or exploit-path expectations — none of which exist as ground-truth
fields today (`groundTruthFindingSchema` has no such fields; see §9.4).
Every proposal below is scoring-semantics-affecting (adding a real,
scorer-enforced expectation, not just documentation) and is therefore
reported for confirmation, per this pass's Task 8 instruction, rather
than applied.

**Expected `evidence_state`** — restates §9.3's table as concrete
proposed field values, since §9.3 was this document's own prose
analysis, not a machine-checkable proposal:

| Fixture | Ground-truth entry | Proposed `evidence_state` |
|---|---|---|
| `access-control-01` | `req-1` | `proven` |
| `database-01` | `req-1` | `proven` |
| `injection-01` | `req-1` | `proven` |
| `webhooks-01` | `req-1` | `proven` |
| `webhooks-01` | `opt-1` | `proven` |
| `concurrency-01` | `req-1` | `proven` |
| `secrets-crypto-01` | `req-1` | `proven` |
| `llm-ai-01` | `req-1` | `proven` |
| `llm-ai-01` | `req-2` | `proven` |
| `multi-tenant-04` | `opt-1` | `strongly_supported` |

The three `safe`/`false_positive_trap` fixtures
(`access-control-02`, `injection-02`) and one more
(`database-02`/`webhooks-03`/etc. — not yet implemented in this first
10) have no ground-truth entries to annotate at all (§3.1's rule: zero
required AND zero optional findings) — `evidence_state` is meaningless
for a fixture whose only correct answer is "no finding."

**Optional standards mapping** — proposing an actual `standards`
citation on a ground-truth entry is explicitly OUT of scope for this
audit pass: `groundTruthFindingSchema` has no `standards` field at all
(only `producedFindingSchema` gained one, Task 2), and per this pass's
own Task 7 instruction, no `owasp-agentic-top10`/`ASIxx` citation may be
proposed anywhere until that standard's item list is primary-source
verified (§1.6). A future proposal for the non-agentic fixtures (e.g.
`injection-01` → `{ framework: "cwe", id: "CWE-89" }`, `secrets-crypto-01`
→ `{ framework: "cwe", id: "CWE-798" }`) is reasonable follow-up work,
not attempted here to avoid scope creep beyond what Task 8 asked for.

**Exploit preconditions / exploit-path expectations** — every one of
the 10 fixtures' `required_findings[]`/`optional_findings[]` entries
already has a populated `exploit_preconditions` field (schema-required,
`groundTruthFindingSchema.exploit_preconditions`); re-reading all 10
confirms none needs a wording change for this refresh (§9.3's own
per-fixture read already covered this — no entry's stated
preconditions conflict with the 2026-09-19 taxonomy update). A
dedicated, MACHINE-CHECKED "exploit path expectation" field (as opposed
to the current human-readable prose) doesn't exist on either side of
the schema and would need its own design pass (what would the scorer
even compare it against, given exploit-path validity is itself
Deferred per §1) — flagged as a real gap, not proposed as a concrete
field here.

**No vulnerability intent was rewritten** for any of the 10 fixtures in
producing this audit — every fixture's `required_findings`/
`optional_findings`/`allowed_categories`/`tags` remain byte-for-byte
what they were before this pass.

### 9.7 Task 7 — primary-source agentic standard handling (confirmed, unchanged)

**Audited, not modified.** The spec (`docs/agents/security-reviewer-v2.md`
§1.6) already withholds exact `ASI01`–`ASI10` item citations pending
primary-source verification — confirmed directly in this pass by
re-reading §1.6 and §3.18: the `ASI01`–`ASI10` table is explicitly
labeled "provisional... sourced from a third-party summary," and §3.18
itself states it "does NOT cite specific `ASIxx` ids as authoritative
per-item standards mappings," citing the standard by name/URL at the
section level only. This plan document (`security-benchmark-plan.md`)
was grepped for any `ASIxx` citation and has none. **No doc change was
needed to satisfy Task 7** — the constraint was already correctly
implemented in the spec before this pass; this pass's own contribution
is keeping it that way in the new code:
`standardsFrameworkSchema` (`scorer.ts`, Task 2) deliberately has no
`"owasp-agentic-top10"` member, so a produced finding cannot cite an
`ASIxx` id through the benchmark's own standards-citation mechanism
either — see that schema's own doc comment. §3.18's agentic-taxonomy
COVERAGE (the 23-item domain breakdown, the fact that this standard
applies) remains fully documented in the spec; only exact per-item ID
citation stays withheld, exactly as Task 7 asked.
