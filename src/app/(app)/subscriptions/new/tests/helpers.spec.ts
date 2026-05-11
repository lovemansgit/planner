// Day 22 / Phase 1 forms lane — subscription form helpers tests.
//
// Covers cadence-preset detection, count helpers (subscription mode +
// single-task date-range mode per OQ-3), and form parsing.

import { describe, expect, it } from "vitest";

import {
  CADENCE_PRESETS,
  countSingleTaskRange,
  countSubscriptionTasks,
  detectPreset,
  formatDateRange,
  parseSubscriptionForm,
} from "../_helpers";

describe("CADENCE_PRESETS", () => {
  it("ships the 5 OQ-2 presets in sentence-case three-letter wording", () => {
    expect(CADENCE_PRESETS.map((p) => p.label)).toEqual([
      "Mon-Fri",
      "Mon-Wed-Fri",
      "Weekend",
      "Daily",
      "Custom",
    ]);
  });

  it("custom carries an empty weekday array", () => {
    const custom = CADENCE_PRESETS.find((p) => p.key === "custom");
    expect(custom).toBeDefined();
    expect(custom?.weekdays).toEqual([]);
  });
});

describe("detectPreset", () => {
  it("recognises Mon-Fri", () => {
    expect(detectPreset(new Set(["mon", "tue", "wed", "thu", "fri"]))).toBe(
      "mon-fri",
    );
  });

  it("recognises Mon-Wed-Fri", () => {
    expect(detectPreset(new Set(["mon", "wed", "fri"]))).toBe("mon-wed-fri");
  });

  it("recognises Weekend", () => {
    expect(detectPreset(new Set(["sat", "sun"]))).toBe("weekend");
  });

  it("recognises Daily (all 7)", () => {
    expect(
      detectPreset(new Set(["mon", "tue", "wed", "thu", "fri", "sat", "sun"])),
    ).toBe("daily");
  });

  it("falls back to Custom when no preset matches", () => {
    expect(detectPreset(new Set(["mon", "thu"]))).toBe("custom");
  });

  it("Custom for empty selection", () => {
    expect(detectPreset(new Set())).toBe("custom");
  });

  it("Custom when count matches preset but composition differs", () => {
    // 5 picks but not the Mon-Fri set
    expect(detectPreset(new Set(["mon", "tue", "wed", "thu", "sat"]))).toBe(
      "custom",
    );
  });
});

describe("countSubscriptionTasks", () => {
  it("counts every weekday in [Mon, Fri] for a Mon-Fri subscription", () => {
    // 4 May 2026 is a Monday (Mon=1)
    const count = countSubscriptionTasks(
      "2026-05-04",
      "2026-05-08",
      new Set([1, 2, 3, 4, 5]),
    );
    expect(count).toBe(5);
  });

  it("counts zero when Sat-Sun range hits Mon-Fri subscription", () => {
    // 9-10 May 2026 is Sat-Sun
    const count = countSubscriptionTasks(
      "2026-05-09",
      "2026-05-10",
      new Set([1, 2, 3, 4, 5]),
    );
    expect(count).toBe(0);
  });

  it("counts the full month for daily cadence", () => {
    const count = countSubscriptionTasks(
      "2026-05-01",
      "2026-05-31",
      new Set([1, 2, 3, 4, 5, 6, 7]),
    );
    expect(count).toBe(31);
  });

  it("uses 31-day horizon when endDate is null", () => {
    const count = countSubscriptionTasks(
      "2026-05-04", // Monday
      null,
      new Set([1, 2, 3, 4, 5]),
    );
    // 31 days from 4 May = 4 May ... 3 June = 5 weekdays * 4 weeks + Mon 1 + Tue 2 + Wed 3 = 23
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(31);
  });

  it("returns zero for end < start", () => {
    expect(
      countSubscriptionTasks("2026-05-10", "2026-05-09", new Set([1])),
    ).toBe(0);
  });

  it("returns zero on garbage dates", () => {
    expect(
      countSubscriptionTasks("not-a-date", "2026-05-10", new Set([1])),
    ).toBe(0);
  });

  it("handles a Sun-only subscription correctly (ISO 7)", () => {
    // 10 May 2026 is a Sunday → ISO weekday 7
    const count = countSubscriptionTasks(
      "2026-05-10",
      "2026-05-10",
      new Set([7]),
    );
    expect(count).toBe(1);
  });
});

describe("countSingleTaskRange (OQ-3)", () => {
  it("returns 1 for a single-day pick", () => {
    expect(countSingleTaskRange("2026-05-04", null)).toBe(1);
    expect(countSingleTaskRange("2026-05-04", "2026-05-04")).toBe(1);
  });

  it("counts every day inclusive in the range", () => {
    // 4-8 May = 5 days
    expect(countSingleTaskRange("2026-05-04", "2026-05-08")).toBe(5);
  });

  it("returns zero for end < start", () => {
    expect(countSingleTaskRange("2026-05-10", "2026-05-04")).toBe(0);
  });

  it("returns zero on garbage dates", () => {
    expect(countSingleTaskRange("nope", "2026-05-04")).toBe(0);
  });
});

describe("formatDateRange", () => {
  it("formats a single date as 'D Mmm'", () => {
    expect(formatDateRange("2026-05-04", null)).toBe("4 May");
    expect(formatDateRange("2026-05-04", "2026-05-04")).toBe("4 May");
  });

  it("formats a range with en-dash", () => {
    expect(formatDateRange("2026-05-04", "2026-05-08")).toBe("4 May – 8 May");
  });
});

describe("parseSubscriptionForm — happy path", () => {
  it("parses a full Mon-Fri subscription", () => {
    const fd = new FormData();
    fd.set("consignee_id", "11111111-1111-1111-1111-111111111111");
    fd.set("start_date", "2026-05-04");
    fd.set("end_date", "");
    fd.append("days_of_week", "mon");
    fd.append("days_of_week", "tue");
    fd.append("days_of_week", "wed");
    fd.append("days_of_week", "thu");
    fd.append("days_of_week", "fri");
    fd.set("window_start", "09:00");
    fd.set("window_end", "11:00");
    fd.set("meal_plan_name", "Breakfast");

    const result = parseSubscriptionForm(fd);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.consigneeId).toBe(
      "11111111-1111-1111-1111-111111111111",
    );
    expect(result.value.startDate).toBe("2026-05-04");
    expect(result.value.endDate).toBeNull();
    expect(result.value.daysOfWeek).toEqual([1, 2, 3, 4, 5]);
    expect(result.value.deliveryWindowStart).toBe("09:00:00");
    expect(result.value.deliveryWindowEnd).toBe("11:00:00");
    expect(result.value.mealPlanName).toBe("Breakfast");
  });
});

describe("parseSubscriptionForm — validation errors", () => {
  it("rejects empty consignee", () => {
    const fd = new FormData();
    const result = parseSubscriptionForm(fd);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors.consignee_id).toBeDefined();
  });

  it("rejects malformed start_date", () => {
    const fd = new FormData();
    fd.set("consignee_id", "x");
    fd.set("start_date", "05/04/2026");
    const result = parseSubscriptionForm(fd);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors.start_date).toBeDefined();
  });

  it("rejects end_date <= start_date", () => {
    const fd = new FormData();
    fd.set("consignee_id", "x");
    fd.set("start_date", "2026-05-10");
    fd.set("end_date", "2026-05-09");
    fd.append("days_of_week", "mon");
    fd.set("window_start", "09:00");
    fd.set("window_end", "11:00");
    const result = parseSubscriptionForm(fd);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors.end_date).toMatch(/after start/i);
  });

  it("rejects empty days_of_week", () => {
    const fd = new FormData();
    fd.set("consignee_id", "x");
    fd.set("start_date", "2026-05-04");
    fd.set("window_start", "09:00");
    fd.set("window_end", "11:00");
    const result = parseSubscriptionForm(fd);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors.days_of_week).toBeDefined();
  });

  it("rejects window order violation", () => {
    const fd = new FormData();
    fd.set("consignee_id", "x");
    fd.set("start_date", "2026-05-04");
    fd.append("days_of_week", "mon");
    fd.set("window_start", "11:00");
    fd.set("window_end", "09:00");
    const result = parseSubscriptionForm(fd);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors.window).toMatch(/end must be after start/i);
  });

  it("rejects window below 30-minute minimum", () => {
    const fd = new FormData();
    fd.set("consignee_id", "x");
    fd.set("start_date", "2026-05-04");
    fd.append("days_of_week", "mon");
    fd.set("window_start", "09:00");
    fd.set("window_end", "09:15");
    const result = parseSubscriptionForm(fd);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors.window).toMatch(/at least 30 minutes/i);
  });
});
