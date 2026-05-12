// Day-24 PM — DateRangeFilter pure-fn spec.
//
// Tests cover the four exported pure helpers. The React component
// itself is not rendered (vitest unit project runs in node env without
// jsdom) — its behaviour is covered by integration / preview walks.

import { describe, expect, it } from "vitest";

import {
  buildButtonLabel,
  buildDateRangeUrl,
  computePresetRange,
  detectActivePreset,
  formatShortDate,
} from "../DateRangeFilter";

const TODAY = "2026-05-15";

describe("computePresetRange — backward presets", () => {
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

describe("computePresetRange — forward presets (Day-24 PM amendment)", () => {
  it("tomorrow → from = to = today + 1", () => {
    expect(computePresetRange("tomorrow", TODAY)).toEqual({
      from: "2026-05-16",
      to: "2026-05-16",
    });
  });

  it("next7 → from = today, to = today + 6 (inclusive 7-day window starting today)", () => {
    expect(computePresetRange("next7", TODAY)).toEqual({
      from: TODAY,
      to: "2026-05-21",
    });
  });

  it("next30 → from = today, to = today + 29 (inclusive 30-day window starting today)", () => {
    expect(computePresetRange("next30", TODAY)).toEqual({
      from: TODAY,
      to: "2026-06-13",
    });
  });

  it("handles month boundary forward (May 31 → tomorrow is June 1)", () => {
    expect(computePresetRange("tomorrow", "2026-05-31")).toEqual({
      from: "2026-06-01",
      to: "2026-06-01",
    });
  });

  it("handles year boundary forward (Dec 20 → next30 reaches into next year)", () => {
    expect(computePresetRange("next30", "2026-12-20")).toEqual({
      from: "2026-12-20",
      to: "2027-01-18",
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

  it("returns 'tomorrow' when from = to = today + 1", () => {
    expect(detectActivePreset("2026-05-16", "2026-05-16", TODAY)).toBe("tomorrow");
  });

  it("returns 'last7' when range matches the rolling 7-day backward window", () => {
    expect(detectActivePreset("2026-05-09", TODAY, TODAY)).toBe("last7");
  });

  it("returns 'last30' when range matches the rolling 30-day backward window", () => {
    expect(detectActivePreset("2026-04-16", TODAY, TODAY)).toBe("last30");
  });

  it("returns 'next7' when range matches the rolling 7-day forward window", () => {
    expect(detectActivePreset(TODAY, "2026-05-21", TODAY)).toBe("next7");
  });

  it("returns 'next30' when range matches the rolling 30-day forward window", () => {
    expect(detectActivePreset(TODAY, "2026-06-13", TODAY)).toBe("next30");
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

describe("formatShortDate", () => {
  it("formats YYYY-MM-DD as 'D Mon'", () => {
    expect(formatShortDate("2026-05-12")).toBe("12 May");
  });

  it("formats single-digit days without zero padding", () => {
    expect(formatShortDate("2026-05-01")).toBe("1 May");
  });

  it("formats December correctly (12-month index sanity)", () => {
    expect(formatShortDate("2026-12-31")).toBe("31 Dec");
  });

  it("returns the raw string on malformed input", () => {
    expect(formatShortDate("not-a-date")).toBe("not-a-date");
  });
});

describe("buildButtonLabel", () => {
  it("returns the preset label for known presets (backward)", () => {
    expect(buildButtonLabel("today", TODAY, TODAY)).toBe("Today");
    expect(buildButtonLabel("yesterday", "2026-05-14", "2026-05-14")).toBe("Yesterday");
    expect(buildButtonLabel("last7", "2026-05-09", TODAY)).toBe("Last 7 days");
    expect(buildButtonLabel("last30", "2026-04-16", TODAY)).toBe("Last 30 days");
  });

  it("returns the preset label for known presets (forward)", () => {
    expect(buildButtonLabel("tomorrow", "2026-05-16", "2026-05-16")).toBe("Tomorrow");
    expect(buildButtonLabel("next7", TODAY, "2026-05-21")).toBe("Next 7 days");
    expect(buildButtonLabel("next30", TODAY, "2026-06-13")).toBe("Next 30 days");
  });

  it("returns 'Custom: <from> – <to>' for a custom range", () => {
    expect(buildButtonLabel("custom", "2026-05-12", "2026-05-19")).toBe(
      "Custom: 12 May – 19 May",
    );
  });

  it("returns 'Custom: <from>' when from = to (custom single-day)", () => {
    expect(buildButtonLabel("custom", "2026-05-12", "2026-05-12")).toBe(
      "Custom: 12 May",
    );
  });
});
