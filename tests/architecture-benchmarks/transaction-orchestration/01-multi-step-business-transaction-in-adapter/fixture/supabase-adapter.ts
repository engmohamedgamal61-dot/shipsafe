import type { Finding, Review } from "@/domain/types";
import type { ReviewRepository } from "./ports";

export class SupabaseReviewRepository implements ReviewRepository {
  async completeReviewWithFindings(reviewId: string, findings: Finding[]): Promise<Review> {
    const review = await this.markReviewRunning(reviewId);
    for (const finding of findings) {
      await this.insertFinding(reviewId, finding);
    }
    const verdict = findings.some((f) => f.severity === "P0") ? "DO_NOT_APPROVE" : "APPROVE";
    await this.setVerdict(reviewId, verdict);
    return { ...review, verdict };
  }

  private async markReviewRunning(reviewId: string): Promise<Review> {
    return {} as Review;
  }

  private async insertFinding(reviewId: string, finding: Finding): Promise<void> {}

  private async setVerdict(reviewId: string, verdict: string): Promise<void> {}
}
