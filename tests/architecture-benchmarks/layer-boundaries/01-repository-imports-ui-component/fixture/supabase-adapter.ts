import type { Repository } from "@/domain/types";
import { RepositoryCard } from "@/components/dashboard/repository-card";
import type { ReviewRepository } from "./ports";

export class SupabaseReviewRepository implements ReviewRepository {
  async listRepositoriesForUser(userId: string): Promise<Repository[]> {
    const rows = await this.fetchRows(userId);
    return rows.map((row) => ({ ...row, displayCard: RepositoryCard({ repository: row }) }));
  }

  private async fetchRows(userId: string): Promise<Repository[]> {
    return [];
  }
}
