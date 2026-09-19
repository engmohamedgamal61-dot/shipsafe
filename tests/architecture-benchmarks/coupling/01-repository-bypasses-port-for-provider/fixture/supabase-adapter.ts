import { AnthropicProvider } from "@/server/review-engine/providers/anthropic-provider";
import type { Repository } from "@/domain/types";
import type { ReviewRepository } from "./ports";

export class SupabaseReviewRepository implements ReviewRepository {
  private readonly provider = new AnthropicProvider(process.env.ANTHROPIC_API_KEY ?? "");

  async listRepositoriesForUser(userId: string): Promise<Repository[]> {
    await this.provider.review({ reviewer: "code", instructions: "summarize", context: null as never, attempt: 1 });
    return [];
  }
}
