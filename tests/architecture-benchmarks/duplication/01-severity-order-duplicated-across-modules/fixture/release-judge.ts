import type { Finding } from "@/domain/types";

const SEVERITY_ORDER = ["NIT", "P2", "P1", "P0"];

export function highestSeverity(findings: Finding[]): string {
  return findings.reduce((worst, f) => (SEVERITY_ORDER.indexOf(f.severity) > SEVERITY_ORDER.indexOf(worst) ? f.severity : worst), "NIT");
}
