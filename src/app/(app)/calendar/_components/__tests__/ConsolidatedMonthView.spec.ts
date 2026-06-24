// Day-23 PM — Spec for the ConsolidatedMonthView pure-logic exports.
// Pure-fn coverage; React render assertions deferred per the
// codebase's no-render-test convention.

import { describe, expect, it } from "vitest";

import {
  buildMonthCellDayHref,
  isDateInMonth,
  parseMonthIndex,
} from "../ConsolidatedMonthView";

describe("parseMonthIndex", () => {
  it("extracts year + month from a YYYY-MM-DD anchor", () => {
    expect(parseMonthIndex("2026-05-01")).toEqual({ year: 2026, month: 5 });
  });
  it("works for any day-of-month, not only the 1st", () => {
    expect(parseMonthIndex("2026-12-31")).toEqual({ year: 2026, month: 12 });
  });
  it("handles year boundaries", () => {
    expect(parseMonthIndex("2027-01-01")).toEqual({ year: 2027, month: 1 });
  });
});

describe("isDateInMonth", () => {
  const may2026 = { year: 2026, month: 5 };

  it("returns true for any day in the same year + month", () => {
    expect(isDateInMonth("2026-05-01", may2026)).toBe(true);
    expect(isDateInMonth("2026-05-15", may2026)).toBe(true);
    expect(isDateInMonth("2026-05-31", may2026)).toBe(true);
  });
  it("returns false for trailing days from the previous month", () => {
    expect(isDateInMonth("2026-04-30", may2026)).toBe(false);
    expect(isDateInMonth("2026-04-27", may2026)).toBe(false);
  });
  it("returns false for leading days from the next month", () => {
    expect(isDateInMonth("2026-06-01", may2026)).toBe(false);
    expect(isDateInMonth("2026-06-07", may2026)).toBe(false);
  });
  it("returns false for dates in a different year (same month number)", () => {
    expect(isDateInMonth("2025-05-15", may2026)).toBe(false);
    expect(isDateInMonth("2027-05-15", may2026)).toBe(false);
  });
});

// Phase 12.2 Batch A · FIX 5 — month-cell drill-down preserves the originating
// month so the day view can return to it. Pre-fix the link was
// `?view=day&date=<date>` with no `month`, so the day view lost where the
// operator came from.
describe("buildMonthCellDayHref", () => {
  it("carries the originating month alongside the day (was dropped pre-fix)", () => {
    const href = buildMonthCellDayHref("2026-05-20", "2026-05-01");
    const params = new URLSearchParams(href.split("?")[1]);
    expect(params.get("view")).toBe("day");
    expect(params.get("date")).toBe("2026-05-20");
    expect(params.get("month")).toBe("2026-05-01");
  });

  it("preserves the filter trail after the month", () => {
    const href = buildMonthCellDayHref("2026-05-20", "2026-05-01", "status=DELIVERED&crm=HIGH_RISK");
    const params = new URLSearchParams(href.split("?")[1]);
    expect(params.get("month")).toBe("2026-05-01");
    expect(params.get("status")).toBe("DELIVERED");
    expect(params.get("crm")).toBe("HIGH_RISK");
  });

  it("an out-of-month trailing cell still anchors back to the grid's month", () => {
    // A June cell shown in the May grid drills to June 1 but returns to May.
    const href = buildMonthCellDayHref("2026-06-01", "2026-05-01");
    const params = new URLSearchParams(href.split("?")[1]);
    expect(params.get("date")).toBe("2026-06-01");
    expect(params.get("month")).toBe("2026-05-01");
  });
});
