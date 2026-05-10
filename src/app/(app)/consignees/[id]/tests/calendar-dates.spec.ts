// Day-21 PR-A2 / Session B — calendar date helper unit tests.
//
// Covers the helpers consumed by CalendarWeekView (existing) and the
// new CalendarMonthView + CalendarYearView surfaces. Pure functions —
// no I/O, no fixtures beyond ISO date strings.
//
// Boundary coverage:
//   - DST-irrelevant (UTC-only date math; no clock offset)
//   - Leap years (Feb 29 2028 → 366-day enumerateDates)
//   - Year-boundary navigation (Dec → next-year Jan)
//   - ISO-Monday anchoring across all 7 weekdays

import { describe, expect, it } from "vitest";

import {
  addDays,
  computeMonthEnd,
  computeMonthGridEnd,
  computeMonthGridStart,
  computeMonthStart,
  computeWeekStart,
  computeYearEnd,
  computeYearStart,
  enumerateDates,
  formatMonthLabel,
  formatYearLabel,
  toIsoDate,
} from "../_components/calendar-dates";

describe("toIsoDate", () => {
  it("formats UTC date as YYYY-MM-DD", () => {
    expect(toIsoDate(new Date("2026-05-10T15:30:00Z"))).toBe("2026-05-10");
  });
});

describe("addDays", () => {
  it("adds positive days", () => {
    expect(addDays("2026-05-10", 5)).toBe("2026-05-15");
  });
  it("adds negative days", () => {
    expect(addDays("2026-05-10", -10)).toBe("2026-04-30");
  });
  it("crosses year boundary forward", () => {
    expect(addDays("2026-12-29", 5)).toBe("2027-01-03");
  });
  it("handles leap-year Feb-29", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2028-02-29", 1)).toBe("2028-03-01");
  });
});

describe("computeWeekStart", () => {
  it("anchors a Monday to itself", () => {
    expect(computeWeekStart(new Date("2026-05-04T00:00:00Z"))).toBe("2026-05-04");
  });
  it("anchors a Sunday to the previous Monday", () => {
    expect(computeWeekStart(new Date("2026-05-10T00:00:00Z"))).toBe("2026-05-04");
  });
  it("anchors a Wednesday mid-week", () => {
    expect(computeWeekStart(new Date("2026-05-06T00:00:00Z"))).toBe("2026-05-04");
  });
  it("crosses month boundary backward", () => {
    expect(computeWeekStart(new Date("2026-06-03T00:00:00Z"))).toBe("2026-06-01");
    expect(computeWeekStart(new Date("2026-06-01T00:00:00Z"))).toBe("2026-06-01");
  });
});

describe("computeMonthStart", () => {
  it("returns first of month for any date in that month", () => {
    expect(computeMonthStart(new Date("2026-05-15T00:00:00Z"))).toBe("2026-05-01");
    expect(computeMonthStart(new Date("2026-05-31T23:59:00Z"))).toBe("2026-05-01");
  });
});

describe("computeMonthEnd", () => {
  it("returns last day of 31-day month", () => {
    expect(computeMonthEnd(new Date("2026-05-15T00:00:00Z"))).toBe("2026-05-31");
  });
  it("returns last day of 30-day month", () => {
    expect(computeMonthEnd(new Date("2026-04-15T00:00:00Z"))).toBe("2026-04-30");
  });
  it("returns Feb-28 on non-leap year", () => {
    expect(computeMonthEnd(new Date("2026-02-15T00:00:00Z"))).toBe("2026-02-28");
  });
  it("returns Feb-29 on leap year", () => {
    expect(computeMonthEnd(new Date("2028-02-15T00:00:00Z"))).toBe("2028-02-29");
  });
});

describe("computeMonthGridStart / computeMonthGridEnd", () => {
  it("expands a month-anchor to its surrounding Mon-of-first-week..Sun-of-last-week range", () => {
    // May 2026: 1st = Friday → grid Mon Apr 27, 31st = Sunday → grid Sun May 31
    expect(computeMonthGridStart("2026-05-01")).toBe("2026-04-27");
    expect(computeMonthGridEnd("2026-05-31")).toBe("2026-05-31");
  });
  it("never returns a range that excludes the month's first day", () => {
    // Sun Aug 1 2027 → grid Mon Jul 26
    expect(computeMonthGridStart("2027-08-01")).toBe("2027-07-26");
  });
});

describe("computeYearStart / computeYearEnd", () => {
  it("anchors year to Jan 1 / Dec 31", () => {
    expect(computeYearStart(new Date("2026-05-10T00:00:00Z"))).toBe("2026-01-01");
    expect(computeYearEnd(new Date("2026-05-10T00:00:00Z"))).toBe("2026-12-31");
  });
});

describe("enumerateDates", () => {
  it("inclusively enumerates a 7-day window", () => {
    const dates = enumerateDates("2026-05-04", "2026-05-10");
    expect(dates).toEqual([
      "2026-05-04",
      "2026-05-05",
      "2026-05-06",
      "2026-05-07",
      "2026-05-08",
      "2026-05-09",
      "2026-05-10",
    ]);
  });
  it("returns a single-day window when start === end", () => {
    expect(enumerateDates("2026-05-10", "2026-05-10")).toEqual(["2026-05-10"]);
  });
  it("counts 366 days across a leap year", () => {
    const dates = enumerateDates("2028-01-01", "2028-12-31");
    expect(dates.length).toBe(366);
    expect(dates[59]).toBe("2028-02-29");
  });
});

describe("formatMonthLabel / formatYearLabel", () => {
  it("formats a month anchor as 'Month YYYY'", () => {
    expect(formatMonthLabel("2026-05-01")).toBe("May 2026");
    expect(formatMonthLabel("2026-12-01")).toBe("December 2026");
  });
  it("formats a year anchor as YYYY only", () => {
    expect(formatYearLabel("2026-01-01")).toBe("2026");
  });
});
