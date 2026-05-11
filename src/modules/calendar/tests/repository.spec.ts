// Day-22n PR-C-A — Calendar repository unit tests.
//
// Mocks `tx.execute` directly so SQL building (filter clauses,
// per-day grouping, top-3 window function, distinct-value lookups,
// 5-metric snapshot) and the row mappers can be exercised without
// a real Postgres connection. Cross-tenant isolation lives in RLS +
// tested in tests/integration/*; these specs verify the *shape* of
// the queries we send.

import { sql as sqlTag, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import {
  buildWeekDays,
  computeMetrics,
  countTasksGroupedByDay,
  listDistinctCrmStates,
  listDistinctDistricts,
  listDistinctTaskStatuses,
  selectTopTasksPerDay,
} from "../repository";
import type { CalendarFilters, CalendarTopTaskForDay } from "../types";

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

  it("threads the time-window filter as a delivery_start_time range", async () => {
    const tx = makeStubTx([[]]);
    await countTasksGroupedByDay(tx, TENANT_ID, WEEK_START, WEEK_END, { window: "morning" });
    const { sql } = compile(tx.execute.mock.calls[0][0]);
    expect(sql).toMatch(/t\.delivery_start_time >= '06:00:00'/);
    expect(sql).toMatch(/t\.delivery_start_time < '12:00:00'/);
  });

  it("emits TRUE for an unknown / empty time-window key (no-op)", async () => {
    const tx = makeStubTx([[]]);
    await countTasksGroupedByDay(tx, TENANT_ID, WEEK_START, WEEK_END, { window: "" });
    const { sql } = compile(tx.execute.mock.calls[0][0]);
    // No range predicates emitted; the WHERE clause carries a literal TRUE.
    expect(sql).not.toMatch(/t\.delivery_start_time >=/);
  });
});

// ---------------------------------------------------------------------------
// selectTopTasksPerDay
// ---------------------------------------------------------------------------

describe("selectTopTasksPerDay", () => {
  const WEEK_START = "2026-05-11";
  const WEEK_END = "2026-05-17";

  it("uses a ROW_NUMBER() partition + rn <= 3 cap inside a subquery", async () => {
    const tx = makeStubTx([[]]);
    await selectTopTasksPerDay(tx, TENANT_ID, WEEK_START, WEEK_END, {});
    const { sql } = compile(tx.execute.mock.calls[0][0]);
    expect(sql).toMatch(/ROW_NUMBER\(\) OVER \(/);
    expect(sql).toMatch(/PARTITION BY t\.delivery_date/);
    expect(sql).toMatch(/ORDER BY t\.delivery_start_time ASC/);
    expect(sql).toMatch(/WHERE rn <= 3/);
  });

  it("maps rows to CalendarTopTaskForDay shape with HH:MM time trimming", async () => {
    const tx = makeStubTx([
      [
        {
          delivery_date: "2026-05-12",
          task_id: "task-1",
          consignee_id: "consignee-1",
          consignee_name: "Sarah Khouri",
          delivery_start_time: "09:30:00",
          internal_status: "CREATED",
          crm_state: "ACTIVE",
        },
        {
          delivery_date: "2026-05-12",
          task_id: "task-2",
          consignee_id: "consignee-2",
          consignee_name: "Ahmed Mansour",
          delivery_start_time: "14:15:00",
          internal_status: "FAILED",
          crm_state: "HIGH_RISK",
        },
      ],
    ]);
    const rows = await selectTopTasksPerDay(tx, TENANT_ID, WEEK_START, WEEK_END, {});
    expect(rows).toEqual([
      {
        deliveryDate: "2026-05-12",
        taskId: "task-1",
        consigneeId: "consignee-1",
        consigneeName: "Sarah Khouri",
        deliveryWindowStart: "09:30",
        status: "CREATED",
        isHighRisk: false,
      },
      {
        deliveryDate: "2026-05-12",
        taskId: "task-2",
        consigneeId: "consignee-2",
        consigneeName: "Ahmed Mansour",
        deliveryWindowStart: "14:15",
        status: "FAILED",
        isHighRisk: true,
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// computeMetrics
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

  it("returns zeros when the row set is empty (defensive — should never happen)", async () => {
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

  it("emits the 5-day FAILED window via INTERVAL '7 days' arithmetic", async () => {
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
    const tx = makeStubTx([
      [{ value: "ACTIVE" }, { value: "HIGH_RISK" }],
    ]);
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

  function topTask(
    deliveryDate: string,
    overrides: Partial<CalendarTopTaskForDay> = {},
  ): CalendarTopTaskForDay & { deliveryDate: string } {
    return {
      deliveryDate,
      taskId: "task-x",
      consigneeId: "consignee-x",
      consigneeName: "Sarah",
      deliveryWindowStart: "09:00",
      status: "CREATED",
      isHighRisk: false,
      ...overrides,
    };
  }

  it("returns exactly 7 days even when only one has data", () => {
    const days = buildWeekDays(
      WEEK_START,
      WEEK_END,
      [{ date: "2026-05-12", total: 5, hasHighRisk: true }],
      [topTask("2026-05-12")],
    );
    expect(days).toHaveLength(7);
    expect(days[0].date).toBe(WEEK_START);
    expect(days[6].date).toBe(WEEK_END);
  });

  it("fills missing days with total=0, hasHighRisk=false, topTasks=[]", () => {
    const days = buildWeekDays(
      WEEK_START,
      WEEK_END,
      [{ date: "2026-05-13", total: 2, hasHighRisk: false }],
      [],
    );
    const monday = days.find((d) => d.date === "2026-05-11");
    expect(monday).toEqual({
      date: "2026-05-11",
      total: 0,
      hasHighRisk: false,
      topTasks: [],
    });
  });

  it("groups topTasks by deliveryDate and preserves caller order", () => {
    const days = buildWeekDays(
      WEEK_START,
      WEEK_END,
      [{ date: "2026-05-12", total: 3, hasHighRisk: false }],
      [
        topTask("2026-05-12", { taskId: "first", deliveryWindowStart: "08:00" }),
        topTask("2026-05-12", { taskId: "second", deliveryWindowStart: "10:00" }),
        topTask("2026-05-12", { taskId: "third", deliveryWindowStart: "14:00" }),
      ],
    );
    const tuesday = days.find((d) => d.date === "2026-05-12");
    expect(tuesday?.topTasks).toHaveLength(3);
    expect(tuesday?.topTasks[0].taskId).toBe("first");
    expect(tuesday?.topTasks[2].taskId).toBe("third");
  });

  it("propagates hasHighRisk from count rows to the corresponding day", () => {
    const days = buildWeekDays(
      WEEK_START,
      WEEK_END,
      [{ date: "2026-05-15", total: 1, hasHighRisk: true }],
      [],
    );
    expect(days.find((d) => d.date === "2026-05-15")?.hasHighRisk).toBe(true);
    expect(days.find((d) => d.date === "2026-05-14")?.hasHighRisk).toBe(false);
  });
});
