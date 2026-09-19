# provider-leakage-01-domain-type-imports-vendor-sdk-type

The domain `Finding` interface embeds `Anthropic.Messages.Message`
directly. This codebase's real `AIProvider` port
(`src/server/review-engine/providers/provider.ts`) exists specifically
so the domain/orchestrator layer never has to know which vendor is
behind it — `AnthropicProvider` and `MockAIProvider` both implement the
same interface, and `container.ts` decides which one is active.

Embedding a vendor SDK type directly into a core domain interface
inverts that: the domain now depends on Anthropic's specific response
shape, so upgrading the SDK or switching providers could force a domain
type change. This is visible today, in the diff, not a speculative
future risk.
