import type { Repository, ReviewWithContext } from "@/domain/types";

/**
 * Persistence port. `InMemoryReviewRepository` (demo mode) and
 * `SupabaseReviewRepository` (configured mode) both implement this; no
 * caller above `src/server/container.ts` knows or cares which one is
 * active.
 */
export interface ReviewRepository {
  listRepositoriesForUser(userId: string): Promise<Repository[]>;
  listReviewsForUser(userId: string): Promise<ReviewWithContext[]>;
  getReviewById(userId: string, reviewId: string): Promise<ReviewWithContext | null>;
}
