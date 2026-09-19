import type { FixtureScore } from "./scorer";

/**
 * Task 6 — plumbing for the plan §1 metrics marked **Deferred**
 * (exploit-path validity, standards-mapping accuracy, remediation
 * quality). These are prepared, never faked: every one of them always
 * reports `"not_measurable"` today, with a specific, honest reason —
 * there is no branch of this module that computes a numeric score,
 * because none of these three can be computed correctly yet (see each
 * function's comment for exactly why). A future pass that actually
 * implements one of these should replace ITS OWN branch here with a
 * real computation; the other two staying `not_measurable` in the
 * meantime is the correct, honest state, not a placeholder to feel bad
 * about.
 */
export type DeferredMetricResult =
  | { status: "not_measurable"; reason: string }
  | { status: "measured"; value: number; sampleSize: number };

export interface DeferredMetrics {
  exploitPathValidity: DeferredMetricResult;
  standardsMappingAccuracy: DeferredMetricResult;
  remediationQuality: DeferredMetricResult;
}

function countP0P1WithChainFields(scores: readonly FixtureScore[]): number {
  let count = 0;
  for (const score of scores) {
    for (const classified of score.allFindings) {
      const f = classified.finding;
      if (f.severity !== "P0" && f.severity !== "P1") continue;
      if (f.securityConsequence !== undefined && f.attackPreconditions !== undefined && f.exploitScenario !== undefined) {
        count += 1;
      }
    }
  }
  return count;
}

function countFindingsWithStandards(scores: readonly FixtureScore[]): number {
  let count = 0;
  for (const score of scores) {
    for (const classified of score.allFindings) {
      if (classified.finding.standards !== undefined) count += 1;
    }
  }
  return count;
}

/**
 * Exploit-path validity (plan §1/§7.1): whether a matched finding's
 * `security_consequence`/`attack_preconditions`/`exploit_scenario`
 * actually form a concrete, traceable chain — NOT just "are the three
 * fields present." Even once those fields exist on a produced finding
 * (Task 2), judging whether the *narrative* they contain is a genuine
 * source→boundary→sink→impact chain (spec §2.1) rather than a
 * plausible-sounding paragraph is a semantic judgment this deterministic
 * scorer cannot make — the plan's §7.1 footnote says exactly this,
 * requiring MANUAL spot-checking of every P0/P1 finding until this
 * metric is real. So: always `not_measurable`, with the count of
 * candidates that would need that manual check surfaced in the reason
 * text, never a fabricated automated verdict.
 */
function exploitPathValidity(scores: readonly FixtureScore[]): DeferredMetricResult {
  const candidates = countP0P1WithChainFields(scores);
  return {
    status: "not_measurable",
    reason:
      candidates > 0
        ? `${candidates} P0/P1 finding(s) supply security_consequence/attack_preconditions/exploit_scenario, but automated chain-validity scoring is not implemented — manual spot-check required per plan §7.1 before any of these count toward a release decision.`
        : "No produced finding supplies security_consequence/attack_preconditions/exploit_scenario yet (Task 2 fields absent from every finding in this run) — production does not emit them today; see adapter.ts's documented limitation.",
  };
}

/**
 * Standards-mapping accuracy (plan §1): whether a finding's `standards`
 * citation is a real id that actually APPLIES to its category — distinct
 * from `standardsCitationSchema`'s format-only validation (`scorer.ts`),
 * which only rejects a syntactically fabricated id, never confirms
 * semantic correctness. Checking "does this specific CWE/OWASP id
 * genuinely apply to this specific finding" requires either a curated
 * category→standards-id mapping table (not built) or a judgment call
 * this deterministic scorer isn't positioned to make — always
 * `not_measurable`.
 */
function standardsMappingAccuracy(scores: readonly FixtureScore[]): DeferredMetricResult {
  const withStandards = countFindingsWithStandards(scores);
  return {
    status: "not_measurable",
    reason:
      withStandards > 0
        ? `${withStandards} finding(s) supply a standards citation (format-validated only); checking whether the id actually applies to its finding's category is not implemented.`
        : "No produced finding supplies a standards citation in this run.",
  };
}

/**
 * Remediation quality (plan §1): `ProducedFinding` (`scorer.ts`) has no
 * `remediation` field at all — deliberately out of Task 2's scope for
 * this pass (only `security_consequence`/`attack_preconditions`/
 * `exploit_scenario`/`standards` were added). Always `not_measurable`
 * as a structural fact, not a per-run observation — there is no run
 * for which this could ever currently read differently.
 */
function remediationQuality(): DeferredMetricResult {
  return {
    status: "not_measurable",
    reason: "ProducedFinding has no `remediation` field yet — out of scope for this pass; add the field before this becomes measurable.",
  };
}

export function computeDeferredMetrics(scores: readonly FixtureScore[]): DeferredMetrics {
  return {
    exploitPathValidity: exploitPathValidity(scores),
    standardsMappingAccuracy: standardsMappingAccuracy(scores),
    remediationQuality: remediationQuality(),
  };
}
