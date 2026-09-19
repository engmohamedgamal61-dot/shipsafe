import type { Finding } from "@/domain/types";

const SEVERITY_ORDER = ["NIT", "P2", "P1", "P0"];

export function sortFindingsBySeverity(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => SEVERITY_ORDER.indexOf(b.severity) - SEVERITY_ORDER.indexOf(a.severity));
}
