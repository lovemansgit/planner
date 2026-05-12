// Day-23 PM — Spec for the ConsolidatedMonthView pure-logic exports.
// Pure-fn coverage; React render assertions deferred per the
// codebase's no-render-test convention.

import { describe, expect, it } from "vitest";

import {
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
