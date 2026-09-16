/**
 * Version of the heuristic rule set that produces a review. Bump this
 * whenever the heuristics in `providers/mock-provider.ts` (or a future
 * real provider's prompt/rule set) change meaningfully enough that an old
 * review shouldn't be assumed comparable to a new one.
 */
export const REVIEW_RULE_VERSION = "heuristic-v1";
