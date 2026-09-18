import { describe, expect, it } from "vitest";
import { formatDateTime } from "./format-date";

describe("formatDateTime", () => {
  it("formats an ISO timestamp as '<Mon> <day>, <year> at <time>' in a pinned locale/timezone", () => {
    const result = formatDateTime("2026-09-18T10:42:00Z", { locale: "en-US", timeZone: "UTC" });
    expect(result).toBe("Sep 18, 2026 at 10:42 AM");
  });

  it("reflects a different timezone when one is given, proving formatting isn't hardcoded to UTC", () => {
    const utc = formatDateTime("2026-09-18T23:30:00Z", { locale: "en-US", timeZone: "UTC" });
    const tokyo = formatDateTime("2026-09-18T23:30:00Z", {
      locale: "en-US",
      timeZone: "Asia/Tokyo",
    });
    expect(utc).not.toBe(tokyo);
    expect(tokyo).toContain("Sep 19, 2026"); // UTC+9 rolls into the next day
  });

  it("returns a safe fallback string for an unparseable timestamp instead of 'Invalid Date'", () => {
    expect(formatDateTime("not-a-real-date")).toBe("Unknown date");
  });
});
