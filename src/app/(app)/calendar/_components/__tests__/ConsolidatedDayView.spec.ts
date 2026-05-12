// Day-23 PM — Spec for the ConsolidatedDayView pure-logic exports.
// Pure-fn coverage; React render assertions deferred per the
// codebase's no-render-test convention.

import { describe, expect, it } from "vitest";

import {
  buildConsigneeLink,
  formatDeliveryTime,
  formatDeliveryWindow,
  getDayHeaderLabel,
  getStatusVisuals,
} from "../ConsolidatedDayView";

describe("formatDeliveryTime", () => {
  it("trims a Postgres TIME (HH:MM:SS) to operator-facing HH:MM", () => {
    expect(formatDeliveryTime("08:30:00")).toBe("08:30");
  });
  it("trims a microsecond-suffixed TIME (HH:MM:SS.NNN) to HH:MM", () => {
    expect(formatDeliveryTime("08:30:00.123")).toBe("08:30");
  });
  it("returns the input unchanged when it does not match HH:MM at the start", () => {
    expect(formatDeliveryTime("invalid")).toBe("invalid");
  });
});

describe("formatDeliveryWindow", () => {
  it("formats the start and end with an em-dash separator", () => {
    expect(formatDeliveryWindow("08:00:00", "10:00:00")).toBe("08:00 — 10:00");
  });
});

describe("getStatusVisuals", () => {
  it("returns the brand red palette for FAILED", () => {
    const visual = getStatusVisuals("FAILED");
    expect(visual.label).toBe("Failed");
    expect(visual.classes).toContain("bg-red/15");
    expect(visual.classes).toContain("text-red");
  });
  it("returns the brand green palette for DELIVERED", () => {
    const visual = getStatusVisuals("DELIVERED");
    expect(visual.label).toBe("Delivered");
    expect(visual.classes).toContain("bg-green/15");
    expect(visual.classes).toContain("text-green");
  });
  it("uses sentence-case labels (not title or caps)", () => {
    expect(getStatusVisuals("IN_TRANSIT").label).toBe("In transit");
    expect(getStatusVisuals("ON_HOLD").label).toBe("On hold");
  });
  it("returns a safe fallback visual for unknown status values", () => {
    const visual = getStatusVisuals("UNKNOWN_NEW_STATUS");
    expect(visual.label).toBe("Unknown");
    expect(visual.classes).toContain("bg-stone-200");
  });
});

describe("getDayHeaderLabel", () => {
  it("formats Friday 2026-05-15 as 'Friday, 15 May 2026'", () => {
    expect(getDayHeaderLabel("2026-05-15")).toBe("Friday, 15 May 2026");
  });
  it("does not drift across UTC midnight (en-GB + UTC tz pinning)", () => {
    // 2026-01-01 is a Thursday.
    expect(getDayHeaderLabel("2026-01-01")).toBe("Thursday, 01 January 2026");
  });
});

describe("buildConsigneeLink", () => {
  it("anchors the link to the Monday of the delivery date's week", () => {
    // 2026-05-15 is Friday; Monday of that week is 2026-05-11.
    expect(buildConsigneeLink("c_123", "2026-05-15")).toBe(
      "/consignees/c_123?tab=calendar&week=2026-05-11",
    );
  });
  it("returns the same Monday for any day within the week", () => {
    const monday = buildConsigneeLink("c_123", "2026-05-11");
    const sunday = buildConsigneeLink("c_123", "2026-05-17");
    expect(monday).toBe(sunday);
  });
  it("crosses year boundaries via week-start computation", () => {
    // 2027-01-01 is Friday; Monday of that week is 2026-12-28.
    expect(buildConsigneeLink("c_xyz", "2027-01-01")).toBe(
      "/consignees/c_xyz?tab=calendar&week=2026-12-28",
    );
  });
});
