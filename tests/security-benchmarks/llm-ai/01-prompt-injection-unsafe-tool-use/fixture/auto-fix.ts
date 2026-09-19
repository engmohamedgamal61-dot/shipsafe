import { anthropicClient } from "@/server/review-engine/providers/anthropic-provider";
import { applyFileEdit } from "@/server/tools/file-writer";

interface AutoFixResult {
  filePath: string;
  newContent: string;
}

/**
 * Asks the model for a one-shot fix suggestion for a PR's diff and
 * applies it directly.
 */
export async function autoFixPullRequest(diffText: string): Promise<void> {
  const prompt = `Review this PR diff and suggest a fix:\n${diffText}\n\nRespond with JSON: { "filePath": string, "newContent": string }`;

  const response = await anthropicClient.messages.create({
    model: "claude-opus-5",
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "{}";
  const result = JSON.parse(text) as AutoFixResult;

  await applyFileEdit(result.filePath, result.newContent);
}
