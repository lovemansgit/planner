// Day-24 fleet bar chart — computeMerchantBarSegments pure-fn spec.
// Replaces the Day-23n sortRows spec after the table → horizontal bar
// chart rewrite. Render-path coverage deferred per
// memory/followup_client_component_test_infra.md.

import { describe, expect, it } from "vitest";

import type { CalendarPerMerchantBreakdownRow } from "../../_types";
import { computeMerchantBarSegments } from "../PerMerchantBreakdownPanel";

function row(
  overrides: Partial<CalendarPerMerchantBreakdownRow>,
): CalendarPerMerchantBreakdownRow {
  return {
    tenantId: "id-default",
    tenantName: "Default",
    tenantSlug: "default",
    totalToday: 0,
    deliveredToday: 0,
    inTransit: 0,
    failedLast7Days: 0,
    ...overrides,
  };
}

describe("computeMerchantBarSegments — empty input", () => {
  it("returns an empty list", () => {
    expect(computeMerchantBarSegments([])).toEqual([]);
  });
});

describe("computeMerchantBarSegments — single merchant", () => {
  const ROWS = [
    row({
      tenantId: "1",
      tenantName: "Solo",
      totalToday: 10,
      deliveredToday: 4,
      inTransit: 2,
      failedLast7Days: 1,
    }),
  ];

  it("scales the single bar to 100% (it is the max)", () => {
    const segs = computeMerchantBarSegments(ROWS);
    expect(segs).toHaveLength(1);
    expect(segs[0]?.totalPct).toBe(100);
  });

  it("splits the bar by status proportions", () => {
    const seg = computeMerchantBarSegments(ROWS)[0]!;
    expect(seg.deliveredPct).toBe(40);
    expect(seg.inTransitPct).toBe(20);
    expect(seg.remainingPct).toBe(40);
  });
});

describe("computeMerchantBarSegments — multiple merchants", () => {
  const ROWS = [
    row({ tenantId: "small", tenantName: "Small", totalToday: 10, deliveredToday: 5, inTransit: 2 }),
    row({ tenantId: "big", tenantName: "Big", totalToday: 50, deliveredToday: 20, inTransit: 5, failedLast7Days: 3 }),
    row({ tenantId: "mid", tenantName: "Mid", totalToday: 25, deliveredToday: 10, inTransit: 5 }),
  ];

  it("sorts segments DESC by totalToday", () => {
    const segs = computeMerchantBarSegments(ROWS);
    expect(segs.map((s) => s.tenantId)).toEqual(["big", "mid", "small"]);
  });

  it("scales totalPct relative to the busiest merchant", () => {
    const segs = computeMerchantBarSegments(ROWS);
    expect(segs[0]?.totalPct).toBe(100); // big = 50/50
    expect(segs[1]?.totalPct).toBe(50); // mid = 25/50
    expect(segs[2]?.totalPct).toBe(20); // small = 10/50
  });

  it("preserves raw counts on each segment", () => {
    const segs = computeMerchantBarSegments(ROWS);
    expect(segs[0]?.deliveredToday).toBe(20);
    expect(segs[0]?.failedLast7Days).toBe(3);
    expect(segs[2]?.totalToday).toBe(10);
  });

  it("does not mutate the input array", () => {
    const before = ROWS.map((r) => r.tenantId);
    computeMerchantBarSegments(ROWS);
    expect(ROWS.map((r) => r.tenantId)).toEqual(before);
  });
});

describe("computeMerchantBarSegments — zero-task rows", () => {
  const ROWS = [
    row({ tenantId: "idle", tenantName: "Idle", totalToday: 0, deliveredToday: 0, inTransit: 0 }),
    row({ tenantId: "active", tenantName: "Active", totalToday: 8, deliveredToday: 3, inTransit: 2 }),
  ];

  it("renders zero-task merchants with collapsed bar", () => {
    const segs = computeMerchantBarSegments(ROWS);
    const idle = segs.find((s) => s.tenantId === "idle")!;
    expect(idle.totalPct).toBe(0);
    expect(idle.deliveredPct).toBe(0);
    expect(idle.inTransitPct).toBe(0);
    expect(idle.remainingPct).toBe(0);
  });

  it("scales other merchants against the active max, ignoring zero rows", () => {
    const segs = computeMerchantBarSegments(ROWS);
    const active = segs.find((s) => s.tenantId === "active")!;
    expect(active.totalPct).toBe(100);
  });
});

describe("computeMerchantBarSegments — all merchants zero", () => {
  const ROWS = [
    row({ tenantId: "a", tenantName: "A", totalToday: 0 }),
    row({ tenantId: "b", tenantName: "B", totalToday: 0 }),
  ];

  it("collapses every bar to 0% width", () => {
    const segs = computeMerchantBarSegments(ROWS);
    expect(segs.every((s) => s.totalPct === 0)).toBe(true);
  });

  it("still surfaces every merchant row (visible name, badge for failed)", () => {
    const segs = computeMerchantBarSegments(ROWS);
    expect(segs.map((s) => s.tenantId).sort()).toEqual(["a", "b"]);
  });
});

describe("computeMerchantBarSegments — count drift defence", () => {
  it("floors remainingPct at zero when delivered+inTransit exceed total", () => {
    const ROWS = [
      // Pathological row: aggregate drift (delivered+inTransit > total).
      // Should not produce a negative remaining; floors at 0.
      row({ tenantId: "x", totalToday: 10, deliveredToday: 7, inTransit: 5 }),
    ];
    const seg = computeMerchantBarSegments(ROWS)[0]!;
    expect(seg.remainingPct).toBe(0);
  });
});
