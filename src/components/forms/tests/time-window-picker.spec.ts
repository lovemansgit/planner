// Day-22 Phase 1 forms — TimeWindowPicker helper unit tests.
//
// Pure helper coverage for validateTimeWindow. Each branch of the
// discriminated-union return type gets a dedicated test; minimum-
// window guard verified at the documented default (30 minutes).

import { describe, expect, it } from "vitest";

import { validateTimeWindow } from "../TimeWindowPicker";

describe("validateTimeWindow", () => {
  it("accepts a valid window", () => {
    const result = validateTimeWindow("09:00", "11:00");
    expect(result).toEqual({ kind: "ok", start: "09:00", end: "11:00" });
  });

  it("flags missing start", () => {
    const result = validateTimeWindow(undefined, "11:00");
    expect(result).toEqual({ kind: "missing", field: "start" });
  });

  it("flags empty-string start as missing", () => {
    const result = validateTimeWindow("", "11:00");
    expect(result).toEqual({ kind: "missing", field: "start" });
  });

  it("flags missing end", () => {
    const result = validateTimeWindow("09:00", undefined);
    expect(result).toEqual({ kind: "missing", field: "end" });
  });

  it("flags malformed start", () => {
    const result = validateTimeWindow("9am", "11:00");
    expect(result).toEqual({ kind: "format", field: "start", raw: "9am" });
  });

  it("flags malformed end", () => {
    const result = validateTimeWindow("09:00", "25:00");
    expect(result).toEqual({ kind: "format", field: "end", raw: "25:00" });
  });

  it("flags out-of-order pair when end <= start", () => {
    const result = validateTimeWindow("11:00", "09:00");
    expect(result).toEqual({ kind: "order", start: "11:00", end: "09:00" });
  });

  it("flags equal start and end as out-of-order", () => {
    const result = validateTimeWindow("10:00", "10:00");
    expect(result).toEqual({ kind: "order", start: "10:00", end: "10:00" });
  });

  it("flags below-minimum window at default (30 min)", () => {
    const result = validateTimeWindow("09:00", "09:15");
    expect(result).toEqual({ kind: "below_minimum", minutes: 15, minimum: 30 });
  });

  it("respects custom minimumMinutes option", () => {
    expect(validateTimeWindow("09:00", "09:15", { minimumMinutes: 10 })).toEqual({
      kind: "ok",
      start: "09:00",
      end: "09:15",
    });
    expect(validateTimeWindow("09:00", "09:30", { minimumMinutes: 60 })).toEqual({
      kind: "below_minimum",
      minutes: 30,
      minimum: 60,
    });
  });

  it("accepts boundary windows: midnight and 23:59", () => {
    expect(validateTimeWindow("00:00", "23:59")).toEqual({
      kind: "ok",
      start: "00:00",
      end: "23:59",
    });
  });

  it("rejects 24:00 (out of HH:MM range)", () => {
    const result = validateTimeWindow("00:00", "24:00");
    expect(result).toEqual({ kind: "format", field: "end", raw: "24:00" });
  });
});
