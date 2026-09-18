import { describe, expect, it } from "vitest";
import { pillContentFor } from "./verdict-pill";

describe("pillContentFor — dashboard status pill", () => {
  it("shows 'Queued' for a pending review with no verdict yet", () => {
    expect(pillContentFor(null, "pending")).toEqual({ kind: "in-progress", label: "Queued" });
  });

  it("shows 'Analyzing…' for a running review with no verdict yet", () => {
    expect(pillContentFor(null, "running")).toEqual({ kind: "in-progress", label: "Analyzing…" });
  });

  it("shows the real verdict for a completed review", () => {
    expect(pillContentFor("APPROVE", "complete")).toEqual({
      kind: "verdict",
      label: "Approve",
      verdict: "APPROVE",
    });
    expect(pillContentFor("APPROVE_WITH_MINOR_FIXES", "complete")).toEqual({
      kind: "verdict",
      label: "Approve with minor fixes",
      verdict: "APPROVE_WITH_MINOR_FIXES",
    });
    expect(pillContentFor("DO_NOT_APPROVE", "complete")).toEqual({
      kind: "verdict",
      label: "Do not approve",
      verdict: "DO_NOT_APPROVE",
    });
  });

  it("shows a distinct 'Failed' state rather than the fail-closed DO_NOT_APPROVE verdict label", () => {
    // Failed reviews always carry verdict DO_NOT_APPROVE (see
    // ReviewOrchestrator.run()'s fail-closed default) — this must not be
    // shown identically to a real AI-reviewed rejection.
    expect(pillContentFor("DO_NOT_APPROVE", "failed")).toEqual({ kind: "failed", label: "Failed" });
  });

  it("falls back to generic 'Pending' when no status is given at all", () => {
    expect(pillContentFor(null)).toEqual({ kind: "in-progress", label: "Pending" });
  });
});
