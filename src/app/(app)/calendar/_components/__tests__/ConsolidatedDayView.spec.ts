// Day-23 PM — Spec for the ConsolidatedDayView pure-logic exports.
// Pure-fn coverage; React render assertions deferred per the
// codebase's no-render-test convention.

import { describe, expect, it } from "vitest";

import {
  buildCalendarBackHref,
  buildConsigneeLink,
  formatDeliveryTime,
  formatDeliveryWindow,
  getDayHeaderLabel,
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

// D56 Lane 5 — the inlined STATUS_VISUALS / getStatusVisuals map was retired
// in favour of the shared `resolveCourierDisplay` (tasks/status.ts), which is
// exhaustively covered by src/app/(app)/tasks/tests/status.spec.ts (fine + coarse
// fallback + null-glyph). The day-view render now reads that single source of
// truth, so there is no surface-local status map left to unit-test here.

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

// Phase 12.2 Batch A · FIX 5 — the "← Back to calendar" affordance (the day view
// previously had NO back/breadcrumb; the view toggle was the only exit and it
// lost the originating month). The back link returns to the month view at the
// month the operator drilled from.
describe("buildCalendarBackHref", () => {
  it("returns the month view anchored at the originating month", () => {
    const href = buildCalendarBackHref("2026-05-01");
    const params = new URLSearchParams(href.split("?")[1]);
    expect(href.split("?")[0]).toBe("/calendar");
    expect(params.get("view")).toBe("month");
    expect(params.get("month")).toBe("2026-05-01");
  });

  it("preserves the active filter trail on the way back", () => {
    const href = buildCalendarBackHref("2026-05-01", "status=DELIVERED&q=sarah");
    const params = new URLSearchParams(href.split("?")[1]);
    expect(params.get("month")).toBe("2026-05-01");
    expect(params.get("status")).toBe("DELIVERED");
    expect(params.get("q")).toBe("sarah");
  });
});
