// Day-23n fleet panels — sortRows pure-fn spec.
// Render-path coverage deferred per
// memory/followup_client_component_test_infra.md.

import { describe, expect, it } from "vitest";

import type { CalendarPerMerchantBreakdownRow } from "../../_types";
import { sortRows } from "../PerMerchantBreakdownPanel";

function row(overrides: Partial<CalendarPerMerchantBreakdownRow>): CalendarPerMerchantBreakdownRow {
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

const ROWS: readonly CalendarPerMerchantBreakdownRow[] = [
  row({ tenantId: "1", tenantName: "Bravo", totalToday: 30, deliveredToday: 15, inTransit: 3, failedLast7Days: 1 }),
  row({ tenantId: "2", tenantName: "Alpha", totalToday: 50, deliveredToday: 20, inTransit: 1, failedLast7Days: 5 }),
  row({ tenantId: "3", tenantName: "Charlie", totalToday: 10, deliveredToday: 2, inTransit: 7, failedLast7Days: 0 }),
];

describe("sortRows — tenantName", () => {
  it("sorts ASC by tenantName (locale-aware)", () => {
    const sorted = sortRows(ROWS, "tenantName", "asc");
    expect(sorted.map((r) => r.tenantName)).toEqual(["Alpha", "Bravo", "Charlie"]);
  });

  it("sorts DESC by tenantName", () => {
    const sorted = sortRows(ROWS, "tenantName", "desc");
    expect(sorted.map((r) => r.tenantName)).toEqual(["Charlie", "Bravo", "Alpha"]);
  });
});

describe("sortRows — numeric columns", () => {
  it("sorts DESC by totalToday (default behaviour)", () => {
    const sorted = sortRows(ROWS, "totalToday", "desc");
    expect(sorted.map((r) => r.tenantId)).toEqual(["2", "1", "3"]);
  });

  it("sorts ASC by totalToday", () => {
    const sorted = sortRows(ROWS, "totalToday", "asc");
    expect(sorted.map((r) => r.tenantId)).toEqual(["3", "1", "2"]);
  });

  it("sorts DESC by deliveredToday", () => {
    const sorted = sortRows(ROWS, "deliveredToday", "desc");
    expect(sorted.map((r) => r.deliveredToday)).toEqual([20, 15, 2]);
  });

  it("sorts DESC by inTransit", () => {
    const sorted = sortRows(ROWS, "inTransit", "desc");
    expect(sorted.map((r) => r.inTransit)).toEqual([7, 3, 1]);
  });

  it("sorts DESC by failedLast7Days", () => {
    const sorted = sortRows(ROWS, "failedLast7Days", "desc");
    expect(sorted.map((r) => r.failedLast7Days)).toEqual([5, 1, 0]);
  });
});

describe("sortRows — input immutability", () => {
  it("does not mutate the input array", () => {
    const before = ROWS.map((r) => r.tenantId);
    sortRows(ROWS, "totalToday", "desc");
    const after = ROWS.map((r) => r.tenantId);
    expect(after).toEqual(before);
  });
});
