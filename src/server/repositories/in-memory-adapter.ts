import type { Repository, ReviewWithContext } from "@/domain/types";
import { getDemoReview, workspaceIdForUser } from "@/server/demo/seed";
import type { ReviewRepository } from "./ports";

/** Demo-mode persistence: everything is derived from the single seeded demo review. */
export class InMemoryReviewRepository implements ReviewRepository {
  async listRepositoriesForUser(userId: string): Promise<Repository[]> {
    const review = await getDemoReview();
    if (review.repository.workspaceId !== workspaceIdForUser(userId)) return [];
    return [review.repository];
  }

  async listReviewsForUser(userId: string): Promise<ReviewWithContext[]> {
    const review = await getDemoReview();
    if (review.repository.workspaceId !== workspaceIdForUser(userId)) return [];
    return [review];
  }

  async getReviewById(userId: string, reviewId: string): Promise<ReviewWithContext | null> {
    const review = await getDemoReview();
    if (review.repository.workspaceId !== workspaceIdForUser(userId)) return null;
    return review.id === reviewId ? review : null;
  }
}
