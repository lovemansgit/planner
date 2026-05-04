// Day 11 / P5 — tests for the URL-param parsers + status filter list.

import { describe, expect, it } from "vitest";

import {
  PAGE_SIZE,
  TASK_STATUS_FILTERS,
  parsePageParam,
  parseStatusParam,
} from "../status";

describe("parseStatusParam", () => {
  it("returns the status verbatim when valid", () => {
    expect(parseStatusParam("DELIVERED")).toBe("DELIVERED");
    expect(parseStatusParam("IN_TRANSIT")).toBe("IN_TRANSIT");
    expect(parseStatusParam("CREATED")).toBe("CREATED");
  });

  it("returns undefined for unknown statuses", () => {
    expect(parseStatusParam("DELIVERED_LATE")).toBeUndefined();
    expect(parseStatusParam("delivered")).toBeUndefined(); // case-sensitive
    expect(parseStatusParam("")).toBeUndefined();
  });

  it("returns undefined for missing or array params", () => {
    expect(parseStatusParam(undefined)).toBeUndefined();
    expect(parseStatusParam(["DELIVERED"])).toBeUndefined();
  });
});

describe("parsePageParam", () => {
  it("parses positive integers", () => {
    expect(parsePageParam("1")).toBe(1);
    expect(parsePageParam("42")).toBe(42);
  });

  it("falls back to 1 for missing / invalid / non-positive input", () => {
    expect(parsePageParam(undefined)).toBe(1);
    expect(parsePageParam("")).toBe(1);
    expect(parsePageParam("abc")).toBe(1);
    expect(parsePageParam("0")).toBe(1);
    expect(parsePageParam("-3")).toBe(1);
  });

  it("returns 1 for array params (rejects ?page=1&page=2)", () => {
    expect(parsePageParam(["2"])).toBe(1);
  });
});

describe("TASK_STATUS_FILTERS catalogue", () => {
  it("covers every TaskInternalStatus value", () => {
    const expected = ["CREATED", "ASSIGNED", "IN_TRANSIT", "DELIVERED", "FAILED", "CANCELED", "ON_HOLD"];
    expect(TASK_STATUS_FILTERS.map((f) => f.value)).toEqual(expected);
  });

  it("each entry has a label and pillClass", () => {
    for (const f of TASK_STATUS_FILTERS) {
      expect(f.label.length).toBeGreaterThan(0);
      expect(f.pillClass.length).toBeGreaterThan(0);
    }
  });
});

describe("PAGE_SIZE", () => {
  it("is a sensible page size for pilot scale", () => {
    expect(PAGE_SIZE).toBeGreaterThan(10);
    expect(PAGE_SIZE).toBeLessThanOrEqual(100);
  });
});
