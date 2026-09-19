import { describe, expect, it } from "vitest";
import { ingestPullRequest } from "./ingest";

describe("ingestPullRequest", () => {
  it("throws when the payload is invalid", () => {
    expect(ingestPullRequest(null)).rejects.toThrow();
  });
});
