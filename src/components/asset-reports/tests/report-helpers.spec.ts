// Report helper unit tests — Day-54 P2.
//
// Pins the page-boundary contracts the drill-down chain hangs off:
// the AWB validation that makes the repository's pg-array literal
// safe, the href builder's empty-set behaviour (no dead links), and
// the shared 30/90-day range parser.

import { describe, expect, it } from "vitest";

import {
  awbsHref,
  isValidAwb,
  parseAwbsParam,
  parseReportRange,
} from "../report-helpers";

describe("isValidAwb / parseAwbsParam", () => {
  it("accepts SF-shaped AWBs and rejects injection-shaped strings", () => {
    expect(isValidAwb("MPL-12345678")).toBe(true);
    expect(isValidAwb("MPS-98410409")).toBe(true);
    expect(isValidAwb("mpl-12345678")).toBe(false);
    expect(isValidAwb("MPL-123','x")).toBe(false);
    expect(isValidAwb("MPL12345678")).toBe(false);
    expect(isValidAwb("")).toBe(false);
  });

  it("parses a comma list, dropping malformed entries and duplicates", () => {
    expect(parseAwbsParam("MPL-11111111,bogus,MPL-22222222,MPL-11111111")).toEqual([
      "MPL-11111111",
      "MPL-22222222",
    ]);
    expect(parseAwbsParam(undefined)).toEqual([]);
    expect(parseAwbsParam("")).toEqual([]);
  });

  it("caps at 200 AWBs (href-length sanity, mirrors the poll cap)", () => {
    const raw = Array.from({ length: 250 }, (_, i) => `MPL-${10000000 + i}`).join(",");
    expect(parseAwbsParam(raw)).toHaveLength(200);
  });
});

describe("awbsHref", () => {
  it("returns null for an empty/invalid set — callers render an unlinked zero", () => {
    expect(awbsHref("/tasks", [])).toBeNull();
    expect(awbsHref("/tasks", ["not an awb"])).toBeNull();
  });

  it("builds the tasks-page href with extra params first", () => {
    const href = awbsHref("/admin/tasks", ["MPL-11111111", "MPL-22222222"], {
      merchant: "demo-bistro",
    });
    expect(href).toBe(
      "/admin/tasks?merchant=demo-bistro&awbs=MPL-11111111%2CMPL-22222222",
    );
  });
});

describe("parseReportRange", () => {
  const TODAY = "2026-06-12";

  it("defaults to the trailing 30 days ending today", () => {
    expect(parseReportRange(undefined, undefined, TODAY)).toEqual({
      from: "2026-05-13",
      to: "2026-06-12",
    });
  });

  it("swaps inverted bounds instead of erroring", () => {
    expect(parseReportRange("2026-06-10", "2026-06-01", TODAY)).toEqual({
      from: "2026-06-01",
      to: "2026-06-10",
    });
  });

  it("clamps the window to 90 days by moving `from` up (plan Q3)", () => {
    expect(parseReportRange("2025-01-01", "2026-06-12", TODAY)).toEqual({
      from: "2026-03-14",
      to: "2026-06-12",
    });
  });

  it("ignores malformed params and falls back to defaults", () => {
    expect(parseReportRange("garbage", "also-garbage", TODAY)).toEqual({
      from: "2026-05-13",
      to: "2026-06-12",
    });
  });
});
