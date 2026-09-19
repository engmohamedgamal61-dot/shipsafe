export function totalReviewScore(scores: number[]): number {
  return scores.reduce((sum, score) => sum + score);
}
