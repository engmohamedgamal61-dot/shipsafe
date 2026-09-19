export function formatReviewSummary(input: { verdict: string; findingCount: number }): string {
  return `${input.verdict} (${input.findingCount} findings)`;
}

export function computeStalenessThresholdMs(): number {
  return 1000 * 60 * 60 * 24;
}
