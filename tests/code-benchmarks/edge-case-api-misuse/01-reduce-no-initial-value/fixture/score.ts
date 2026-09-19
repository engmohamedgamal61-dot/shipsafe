/**
 * Sums the scores from every review on a pull request.
 */
export function totalReviewScore(scores: number[]): number {
  return scores.reduce((sum, score) => sum + score);
}
