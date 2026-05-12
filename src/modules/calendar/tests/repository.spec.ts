// Day-22n PR-C-A + Day-23n polish — Calendar repository unit tests.
//
// Mocks `tx.execute` directly so SQL building (filter clauses,
// per-day grouping, distinct-value lookups, 5-metric snapshots) and
// the row mappers can be exercised without a real Postgres
// connection. Cross-tenant isolation lives in RLS + tested in
// tests/integration/*; these specs verify the *shape* of the
// queries we send.

import { type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import {
  buildWeekDays,
  computeMetrics,
  computeTranscorpAdminMetrics,
  countTasksGroupedByDay,
  listDistinctCrmStates,
  listDistinctDistricts,
  listDistinctTaskStatuses,
} from "../repository";
import type { CalendarFilters } from "../types";

const TENANT_ID = "00000000-0000-0000-0000-00000000000a";

const dialect = new PgDialect();

function compile(query: unknown): { sql: string; params: unknown[] } {
  const compiled = dialect.sqlToQuery(query as SQL);
  return { sql: compiled.sql, params: compiled.params };
}

function makeStubTx(executeReturns: unknown[]) {
  let call = 0;
  const execute = vi.fn(async () => {
    const value = executeReturns[call] ?? [];
    call += 1;
    return value;
  });
  return { execute } as unknown as Parameters<typeof countTasksGroupedByDay>[0] & {
    execute: ReturnType<typeof vi.fn>;
  };
}

// ---------------------------------------------------------------------------
// countTasksGroupedByDay
// ---------------------------------------------------------------------------

describe("countTasksGroupedByDay", () => {
  const WEEK_START = "2026-05-11"; // Monday
  const WEEK_END = "2026-05-17"; // Sunday

  it("issues one execute() call with the tenant + range predicates bound", async () => {
    const tx = makeStubTx([
      [{ delivery_date: "2026-05-12", total: 5, has_high_risk: true }],
    ]);
    await countTasksGroupedByDay(tx, TENANT_ID, WEEK_START, WEEK_END, {});
    expect(tx.execute).toHaveBeenCalledOnce();
    const { sql, params } = compile(tx.execute.mock.calls[0][0]);
    expect(sql).toMatch(/FROM tasks t/);
    expect(sql).toMatch(/JOIN consignees c/);
    expect(sql).toMatch(/GROUP BY t.delivery_date/);
    expect(sql).toMatch(/bool_or\(c.crm_state = 'HIGH_RISK'\)/);
    expect(params).toContain(TENANT_ID);
    expect(params).toContain(WEEK_START);
    expect(params).toContain(WEEK_END);
  });

  it("maps rows to the camelCase domain shape with total coerced to number", async () => {
    const tx = makeStubTx([
      [
        { delivery_date: "2026-05-12", total: "5", has_high_risk: false },
        { delivery_date: "2026-05-13", total: 3, has_high_risk: true },
      ],
    ]);
    const rows = await countTasksGroupedByDay(tx, TENANT_ID, WEEK_START, WEEK_END, {});
    expect(rows).toEqual([
      { date: "2026-05-12", total: 5, hasHighRisk: false },
      { date: "2026-05-13", total: 3, hasHighRisk: true },
    ]);
  });

  it("threads the q filter through as ILIKE with %wrap%", async () => {
    const tx = makeStubTx([[]]);
    await countTasksGroupedByDay(tx, TENANT_ID, WEEK_START, WEEK_END, { q: "Sarah" });
    const { sql, params } = compile(tx.execute.mock.calls[0][0]);
    expect(sql).toMatch(/c\.name ILIKE/);
    expect(params).toContain("%Sarah%");
  });

  it("threads the crm + district + status filters as exact-match predicates", async () => {
    const filters: CalendarFilters = {
      crm: "HIGH_RISK",
      district: "Al Quoz",
      status: "FAILED",
    };
    const tx = makeStubTx([[]]);
    await countTasksGroupedByDay(tx, TENANT_ID, WEEK_START, WEEK_END, filters);
    const { sql, params } = compile(tx.execute.mock.calls[0][0]);
    expect(sql).toMatch(/c\.crm_state = /);
    expect(sql).toMatch(/c\.district = /);
    expect(sql).toMatch(/t\.internal_status = /);
    expect(params).toContain("HIGH_RISK");
    expect(params).toContain("Al Quoz");
    expect(params).toContain("FAILED");
  });

  it("does NOT emit any delivery_start_time predicate (window filter dropped Day-23n)", async () => {
    const tx = makeStubTx([[]]);
    await countTasksGroupedByDay(tx, TENANT_ID, WEEK_START, WEEK_END, {});
    const { sql } = compile(tx.execute.mock.calls[0][0]);
    expect(sql).not.toMatch(/t\.delivery_start_time/);
  });
});

// ---------------------------------------------------------------------------
// computeMetrics (tenant-scoped)
// ---------------------------------------------------------------------------

describe("computeMetrics", () => {
  const TODAY = "2026-05-11";

  it("returns the five metrics from a single round-trip", async () => {
    const tx = makeStubTx([
      [
        {
          active_consignees: 42,
          today_deliveries_scheduled: 12,
          delivered_today: 5,
          out_for_delivery: 3,
          failed_at_risk: 2,
        },
      ],
    ]);
    const result = await computeMetrics(tx, TENANT_ID, TODAY, {});
    expect(tx.execute).toHaveBeenCalledOnce();
    expect(result).toEqual({
      activeConsignees: 42,
      todayDeliveriesScheduled: 12,
      deliveredToday: 5,
      outForDelivery: 3,
      failedAtRisk: 2,
    });
  });

  it("returns zeros when the row set is empty", async () => {
    const tx = makeStubTx([[]]);
    const result = await computeMetrics(tx, TENANT_ID, TODAY, {});
    expect(result).toEqual({
      activeConsignees: 0,
      todayDeliveriesScheduled: 0,
      deliveredToday: 0,
      outForDelivery: 0,
      failedAtRisk: 0,
    });
  });

  it("coerces bigint strings to numbers", async () => {
    const tx = makeStubTx([
      [
        {
          active_consignees: "42",
          today_deliveries_scheduled: "12",
          delivered_today: "5",
          out_for_delivery: "3",
          failed_at_risk: "2",
        },
      ],
    ]);
    const result = await computeMetrics(tx, TENANT_ID, TODAY, {});
    expect(result.activeConsignees).toBe(42);
    expect(typeof result.activeConsignees).toBe("number");
  });

  it("emits the 7-day FAILED window via INTERVAL '7 days' arithmetic", async () => {
    const tx = makeStubTx([[]]);
    await computeMetrics(tx, TENANT_ID, TODAY, {});
    const { sql } = compile(tx.execute.mock.calls[0][0]);
    expect(sql).toMatch(/INTERVAL '7 days'/);
    expect(sql).toMatch(/t\.internal_status = 'FAILED'/);
    expect(sql).toMatch(/c\.crm_state = 'HIGH_RISK'/);
  });

  it("anchors activeConsignees on crm_state IN ('ACTIVE', 'HIGH_RISK')", async () => {
    const tx = makeStubTx([[]]);
    await computeMetrics(tx, TENANT_ID, TODAY, {});
    const { sql } = compile(tx.execute.mock.calls[0][0]);
    expect(sql).toMatch(/c\.crm_state IN \('ACTIVE', 'HIGH_RISK'\)/);
  });
});

// ---------------------------------------------------------------------------
// computeTranscorpAdminMetrics (cross-tenant)
// ---------------------------------------------------------------------------

describe("computeTranscorpAdminMetrics", () => {
  const TODAY = "2026-05-11";

  it("returns the five cross-tenant metrics from a single round-trip", async () => {
    const tx = makeStubTx([
      [
        {
          active_merchants: 4,
          total_deliveries_today: 120,
          delivered_today: 45,
          in_transit: 18,
          failed_last_7_days: 6,
        },
      ],
    ]);
    const result = await computeTranscorpAdminMetrics(tx, TODAY);
    expect(tx.execute).toHaveBeenCalledOnce();
    expect(result).toEqual({
      activeMerchants: 4,
      totalDeliveriesToday: 120,
      deliveredToday: 45,
      inTransit: 18,
      failedLast7Days: 6,
    });
  });

  it("emits no tenant-scoped WHERE predicate (cross-tenant aggregate)", async () => {
    const tx = makeStubTx([[]]);
    await computeTranscorpAdminMetrics(tx, TODAY);
    const { sql, params } = compile(tx.execute.mock.calls[0][0]);
    expect(sql).not.toMatch(/tenant_id\s*=/);
    expect(sql).toMatch(/FROM tenants/);
    expect(sql).toMatch(/status = 'active'/);
    expect(sql).toMatch(/internal_status = 'DELIVERED'/);
    expect(sql).toMatch(/internal_status = 'IN_TRANSIT'/);
    expect(sql).toMatch(/internal_status = 'FAILED'/);
    expect(sql).toMatch(/INTERVAL '7 days'/);
    expect(params).toContain(TODAY);
  });

  it("coerces bigint strings to numbers", async () => {
    const tx = makeStubTx([
      [
        {
          active_merchants: "4",
          total_deliveries_today: "120",
          delivered_today: "45",
          in_transit: "18",
          failed_last_7_days: "6",
        },
      ],
    ]);
    const result = await computeTranscorpAdminMetrics(tx, TODAY);
    expect(result.activeMerchants).toBe(4);
    expect(typeof result.totalDeliveriesToday).toBe("number");
  });

  it("returns zeros when row set is empty", async () => {
    const tx = makeStubTx([[]]);
    const result = await computeTranscorpAdminMetrics(tx, TODAY);
    expect(result).toEqual({
      activeMerchants: 0,
      totalDeliveriesToday: 0,
      deliveredToday: 0,
      inTransit: 0,
      failedLast7Days: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// listDistinctDistricts / CrmStates / TaskStatuses
// ---------------------------------------------------------------------------

describe("listDistinctDistricts", () => {
  it("filters out empty + null values and returns the strings sorted", async () => {
    const tx = makeStubTx([
      [{ value: "Al Quoz" }, { value: "Jumeirah" }, { value: "" }, { value: null }],
    ]);
    const rows = await listDistinctDistricts(tx, TENANT_ID);
    expect(rows).toEqual(["Al Quoz", "Jumeirah"]);
  });
});

describe("listDistinctCrmStates", () => {
  it("returns the crm_state values that exist for the tenant", async () => {
    const tx = makeStubTx([[{ value: "ACTIVE" }, { value: "HIGH_RISK" }]]);
    const rows = await listDistinctCrmStates(tx, TENANT_ID);
    expect(rows).toEqual(["ACTIVE", "HIGH_RISK"]);
  });
});

describe("listDistinctTaskStatuses", () => {
  it("returns the internal_status values that exist for the tenant", async () => {
    const tx = makeStubTx([
      [{ value: "CREATED" }, { value: "DELIVERED" }, { value: "FAILED" }],
    ]);
    const rows = await listDistinctTaskStatuses(tx, TENANT_ID);
    expect(rows).toEqual(["CREATED", "DELIVERED", "FAILED"]);
  });
});

// ---------------------------------------------------------------------------
// buildWeekDays — pure assembly helper
// ---------------------------------------------------------------------------

describe("buildWeekDays", () => {
  const WEEK_START = "2026-05-11"; // Monday
  const WEEK_END = "2026-05-17"; // Sunday

  it("returns exactly 7 days even when only one has data", () => {
    const days = buildWeekDays(
      WEEK_START,
      WEEK_END,
      [{ date: "2026-05-12", total: 5, hasHighRisk: true }],
    );
    expect(days).toHaveLength(7);
    expect(days[0].date).toBe(WEEK_START);
    expect(days[6].date).toBe(WEEK_END);
  });

  it("fills missing days with total=0 and hasHighRisk=false", () => {
    const days = buildWeekDays(
      WEEK_START,
      WEEK_END,
      [{ date: "2026-05-13", total: 2, hasHighRisk: false }],
    );
    const monday = days.find((d) => d.date === "2026-05-11");
    expect(monday).toEqual({
      date: "2026-05-11",
      total: 0,
      hasHighRisk: false,
    });
  });

  it("propagates hasHighRisk from count rows to the corresponding day", () => {
    const days = buildWeekDays(
      WEEK_START,
      WEEK_END,
      [{ date: "2026-05-15", total: 1, hasHighRisk: true }],
    );
    expect(days.find((d) => d.date === "2026-05-15")?.hasHighRisk).toBe(true);
    expect(days.find((d) => d.date === "2026-05-14")?.hasHighRisk).toBe(false);
  });
});
