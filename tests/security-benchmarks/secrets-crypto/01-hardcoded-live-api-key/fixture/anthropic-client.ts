import Anthropic from "@anthropic-ai/sdk";

/**
 * Shared Claude client for the review engine.
 */
export function createReviewerAnthropicClient(): Anthropic {
  return new Anthropic({
    apiKey: "sk-ant-api03-KJ8x2mNPq7RtVbY4wZcL9dFhGjKl3nOpQrStUvWxYz01AbCdEfGh-AA",
  });
}
