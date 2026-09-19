export function computeAutoMergeEligibility(verdict: string, findings: { severity: string }[]): boolean {
  if (verdict !== "APPROVE") return false;
  if (findings.some((f) => f.severity === "P0" || f.severity === "P1")) return false;
  return true;
}
