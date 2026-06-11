// Day-51 / R9 — CalendarViewToggle view-resolution + segment coverage.
//
// Pure-fn coverage per the house pattern (React render assertions
// deferred — memory/followup_client_component_test_infra.md). Asserts
// the R9 contract: Week view removed, ?view=week falls back to Month
// silently, and the toggle exposes only Month + Year segments.

import { describe, expect, it } from "vitest";

import {
  CALENDAR_VIEW_SEGMENTS,
  resolveCalendarView,
  VALID_CALENDAR_VIEWS,
} from "../_components/CalendarViewToggle";

describe("resolveCalendarView (R9 deep-link fallback)", () => {
  it("retired ?view=week falls back silently to Month", () => {
    expect(resolveCalendarView("week")).toBe("month");
  });
  it("unknown / empty view falls back to Month", () => {
    expect(resolveCalendarView("garbage")).toBe("month");
    expect(resolveCalendarView("")).toBe("month");
  });
  it("absent view param defaults to Month", () => {
    expect(resolveCalendarView(undefined)).toBe("month");
  });
  it("explicit month stays Month", () => {
    expect(resolveCalendarView("month")).toBe("month");
  });
  it("explicit year stays Year", () => {
    expect(resolveCalendarView("year")).toBe("year");
  });
});

describe("CalendarViewToggle segments (R9 — no Week option)", () => {
  it("exposes exactly Month + Year, in order, with no Week", () => {
    expect(CALENDAR_VIEW_SEGMENTS.map((s) => s.name)).toEqual(["month", "year"]);
    expect(CALENDAR_VIEW_SEGMENTS.some((s) => (s.name as string) === "week")).toBe(false);
  });
  it("VALID_CALENDAR_VIEWS contains no week", () => {
    expect(VALID_CALENDAR_VIEWS).toEqual(["month", "year"]);
    expect((VALID_CALENDAR_VIEWS as readonly string[]).includes("week")).toBe(false);
  });
});
