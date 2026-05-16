// tests/unit/dubai-date.spec.ts
// =============================================================================
// Day-28 — pure-unit coverage for the materialization horizon helper.
//
// Pins the post-bump horizon at 21 calendar days in Asia/Dubai. The
// underlying constant lives at
// `src/modules/task-materialization/dubai-date.ts` as
// `MATERIALIZATION_HORIZON_DAYS = 21` and is bumped from 14 in this
// commit. The cron consumes the helper at handler entry
// (`src/app/api/cron/generate-tasks/route.ts:123`); all per-tenant
// SQL inherits the same value via the function's return.
//
// Cap-headroom rationale + Day-28 production evidence (run-row
// `capped_by_gate: false` on all 6 cron-eligible tenants at 14d, with
// 200/145/500 sub distribution) is in the JSDoc on the constant.
// =============================================================================

import { describe, expect, it } from "vitest";

import {
  computeTargetDateInDubai,
  computeTodayInDubai,
} from "../../src/modules/task-materialization/dubai-date";

describe("computeTargetDateInDubai — 21-day horizon", () => {
  it("returns today_in_dubai + 21 for a UTC noon instant", () => {
    // 2026-05-16T12:00:00Z = 2026-05-16T16:00:00 in Dubai (UTC+4).
    // Today-in-Dubai is 2026-05-16; target = 2026-06-06 (+21 days).
    const now = new Date("2026-05-16T12:00:00.000Z");
    expect(computeTargetDateInDubai(now)).toBe("2026-06-06");
  });

  it("handles UTC instants late enough that Dubai is on the next calendar day", () => {
    // 2026-05-16T23:00:00Z = 2026-05-17T03:00:00 in Dubai.
    // Today-in-Dubai is 2026-05-17; target = 2026-06-07 (+21).
    const now = new Date("2026-05-16T23:00:00.000Z");
    expect(computeTargetDateInDubai(now)).toBe("2026-06-07");
  });

  it("handles UTC instants before Dubai midnight on Dubai-current day", () => {
    // 2026-05-16T19:59:59Z = 2026-05-16T23:59:59 in Dubai.
    // Today-in-Dubai is 2026-05-16; target = 2026-06-06 (+21).
    const now = new Date("2026-05-16T19:59:59.000Z");
    expect(computeTargetDateInDubai(now)).toBe("2026-06-06");
  });

  it("handles UTC instants exactly at Dubai midnight (boundary)", () => {
    // 2026-05-16T20:00:00Z = 2026-05-17T00:00:00 in Dubai.
    // Today-in-Dubai is 2026-05-17; target = 2026-06-07.
    const now = new Date("2026-05-16T20:00:00.000Z");
    expect(computeTargetDateInDubai(now)).toBe("2026-06-07");
  });

  it("crosses calendar-month boundaries cleanly", () => {
    // 2026-05-25T12:00:00Z = 2026-05-25T16:00:00 in Dubai.
    // Today-in-Dubai is 2026-05-25; target = 2026-06-15 (+21, crosses month).
    const now = new Date("2026-05-25T12:00:00.000Z");
    expect(computeTargetDateInDubai(now)).toBe("2026-06-15");
  });

  it("crosses calendar-year boundaries cleanly", () => {
    // 2026-12-20T12:00:00Z = 2026-12-20T16:00:00 in Dubai.
    // Today-in-Dubai is 2026-12-20; target = 2027-01-10 (+21, crosses year).
    const now = new Date("2026-12-20T12:00:00.000Z");
    expect(computeTargetDateInDubai(now)).toBe("2027-01-10");
  });

  it("delta between computeTargetDateInDubai and computeTodayInDubai is exactly 21 calendar days", () => {
    // Sanity invariant: the target should always be today + 21 in Dubai
    // regardless of the input instant. Asserts the constant is in sync
    // between the two helpers.
    const now = new Date("2026-05-16T12:00:00.000Z");
    const today = computeTodayInDubai(now);
    const target = computeTargetDateInDubai(now);
    const deltaMs =
      new Date(`${target}T00:00:00.000Z`).getTime() -
      new Date(`${today}T00:00:00.000Z`).getTime();
    expect(deltaMs / (24 * 60 * 60 * 1000)).toBe(21);
  });
});

describe("computeTodayInDubai — companion helper (no horizon offset)", () => {
  it("returns today_in_dubai for UTC noon instants", () => {
    const now = new Date("2026-05-16T12:00:00.000Z");
    expect(computeTodayInDubai(now)).toBe("2026-05-16");
  });

  it("returns the Dubai calendar day for after-midnight-Dubai UTC instants", () => {
    // 2026-05-16T22:00:00Z = 2026-05-17T02:00:00 in Dubai.
    const now = new Date("2026-05-16T22:00:00.000Z");
    expect(computeTodayInDubai(now)).toBe("2026-05-17");
  });
});
