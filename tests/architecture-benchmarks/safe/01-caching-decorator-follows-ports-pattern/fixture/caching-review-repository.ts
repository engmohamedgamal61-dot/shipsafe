import type { Repository, ReviewWithContext } from "@/domain/types";
import type { ReviewRepository } from "./ports";

/**
 * Read-only cache decorator around any ReviewRepository — adds an
 * in-process TTL cache without changing the port's contract or callers.
 */
export class CachingReviewRepository implements ReviewRepository {
  private cache = new Map<string, { value: Repository[]; expiresAt: number }>();

  constructor(
    private readonly inner: ReviewRepository,
    private readonly ttlMs: number,
  ) {}

  async listRepositoriesForUser(userId: string): Promise<Repository[]> {
    const cached = this.cache.get(userId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const value = await this.inner.listRepositoriesForUser(userId);
    this.cache.set(userId, { value, expiresAt: Date.now() + this.ttlMs });
    return value;
  }

  listReviewsForUser(userId: string): Promise<ReviewWithContext[]> {
    return this.inner.listReviewsForUser(userId);
  }

  getReviewById(userId: string, reviewId: string): Promise<ReviewWithContext | null> {
    return this.inner.getReviewById(userId, reviewId);
  }
}
