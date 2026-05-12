// Day-24 PM — DateRangeFilter pure-fn spec.
//
// Tests cover the three exported pure helpers. The React component
// itself is not rendered (vitest unit project runs in node env without
// jsdom) — its behaviour is covered by integration / preview walks.

import { describe, expect, it } from "vitest";

import {
  buildDateRangeUrl,
  computePresetRange,
  detectActivePreset,
} from "../DateRangeFilter";

const TODAY = "2026-05-15";

describe("computePresetRange", () => {
  it("today → from = to = today", () => {
    expect(computePresetRange("today", TODAY)).toEqual({ from: TODAY, to: TODAY });
  });

  it("yesterday → from = to = today - 1", () => {
    expect(computePresetRange("yesterday", TODAY)).toEqual({
      from: "2026-05-14",
      to: "2026-05-14",
    });
  });

  it("last7 → from = today - 6, to = today (inclusive window)", () => {
    expect(computePresetRange("last7", TODAY)).toEqual({
      from: "2026-05-09",
      to: TODAY,
    });
  });

  it("last30 → from = today - 29, to = today (inclusive window)", () => {
    expect(computePresetRange("last30", TODAY)).toEqual({
      from: "2026-04-16",
      to: TODAY,
    });
  });

  it("handles month boundary correctly (May 1 → yesterday is April 30)", () => {
    expect(computePresetRange("yesterday", "2026-05-01")).toEqual({
      from: "2026-04-30",
      to: "2026-04-30",
    });
  });

  it("handles year boundary correctly (Jan 1 → last30 reaches into prior year)", () => {
    expect(computePresetRange("last30", "2026-01-15")).toEqual({
      from: "2025-12-17",
      to: "2026-01-15",
    });
  });
});

describe("detectActivePreset", () => {
  it("returns 'today' when from = to = today", () => {
    expect(detectActivePreset(TODAY, TODAY, TODAY)).toBe("today");
  });

  it("returns 'yesterday' when from = to = today - 1", () => {
    expect(detectActivePreset("2026-05-14", "2026-05-14", TODAY)).toBe("yesterday");
  });

  it("returns 'last7' when range matches the rolling 7-day window", () => {
    expect(detectActivePreset("2026-05-09", TODAY, TODAY)).toBe("last7");
  });

  it("returns 'last30' when range matches the rolling 30-day window", () => {
    expect(detectActivePreset("2026-04-16", TODAY, TODAY)).toBe("last30");
  });

  it("returns 'custom' when range does not match any preset", () => {
    expect(detectActivePreset("2026-05-01", "2026-05-10", TODAY)).toBe("custom");
  });

  it("returns 'custom' when from > to (defensive — page boundary should normalise)", () => {
    expect(detectActivePreset("2026-05-20", "2026-05-10", TODAY)).toBe("custom");
  });
});

describe("buildDateRangeUrl", () => {
  it("sets both from and to, returns basePath with query string", () => {
    const params = new URLSearchParams();
    expect(buildDateRangeUrl(params, TODAY, TODAY, "/admin/tasks")).toBe(
      `/admin/tasks?from=${TODAY}&to=${TODAY}`,
    );
  });

  it("preserves other search params (merchant, status, q)", () => {
    const params = new URLSearchParams("merchant=mpl&status=DELIVERED&q=sarah");
    const url = buildDateRangeUrl(params, TODAY, TODAY, "/admin/tasks");
    expect(url).toContain("merchant=mpl");
    expect(url).toContain("status=DELIVERED");
    expect(url).toContain("q=sarah");
    expect(url).toContain(`from=${TODAY}`);
    expect(url).toContain(`to=${TODAY}`);
  });

  it("always drops the page param on filter write", () => {
    const params = new URLSearchParams("page=3&merchant=mpl");
    const url = buildDateRangeUrl(params, TODAY, TODAY, "/admin/tasks");
    expect(url).not.toContain("page=");
    expect(url).toContain("merchant=mpl");
  });

  it("empty from + to → deletes both params from URL", () => {
    const params = new URLSearchParams(`from=2026-01-01&to=2026-01-31&merchant=mpl`);
    const url = buildDateRangeUrl(params, "", "", "/admin/tasks");
    expect(url).not.toContain("from=");
    expect(url).not.toContain("to=");
    expect(url).toContain("merchant=mpl");
  });

  it("returns basePath without query when no params remain", () => {
    const params = new URLSearchParams();
    const url = buildDateRangeUrl(params, "", "", "/admin/tasks");
    expect(url).toBe("/admin/tasks");
  });

  it("works with the tenant basePath too", () => {
    const params = new URLSearchParams("q=ABC");
    expect(buildDateRangeUrl(params, TODAY, TODAY, "/tasks")).toBe(
      `/tasks?q=ABC&from=${TODAY}&to=${TODAY}`,
    );
  });
});
