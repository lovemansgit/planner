// tests/integration/calendar-day-view.spec.ts
// =============================================================================
// Day-23 PM schema-drift regression pin for
// listTasksForDayAcrossConsignees (src/modules/calendar/repository.ts).
//
// Bug class: SELECT-clause column drift between the `tasks` table
// (per-task `delivery_start_time` + `delivery_end_time` per
// 0006_task.sql:143-144) and the similarly-named columns on the
// `subscriptions` table (`delivery_window_start` + `delivery_window_end`
// per 0009_subscription.sql:141-142). The two pairs encode the same
// concept on different tables; selecting the wrong-table columns
// raises Postgres 42703 column-does-not-exist.
//
// This bug class is invisible at the unit-test layer because mocked
// `tx.execute` never exercises real Postgres column resolution. Real-
// Postgres integration coverage is the only regression-grade signal,
// per memory/followup_repo_layer_integration_coverage_discipline.md.
//
// Cases pinned:
//   1. Zero tasks for the date → returns []
//   2. One task for the date → returns one row with the camelCase
//      domain mapping (deliveryWindowStart sourced from
//      tasks.delivery_start_time at the SQL layer)
//   3. Three tasks for the date → returns three rows ordered by
//      delivery_start_time ASC then consignee name ASC
//   4. Cross-tenant filter — tasks from another tenant not surfaced
//   5. Empty filter set vs filter narrowing (status filter)
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { listTasksForDayAcrossConsignees } from "../../src/modules/calendar/repository";
import { withServiceRole } from "../../src/shared/db";
import type { Uuid } from "../../src/shared/types";

const RUN_ID = randomUUID().slice(0, 8);
const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const SLUG_A = `cdv-${RUN_ID}-a`;
const SLUG_B = `cdv-${RUN_ID}-b`;

// Two distinct dates so the day-scope filter has surface to assert on.
const DAY_WITH_TASKS = "2026-05-15"; // Friday
const DAY_EMPTY = "2026-05-16"; // Saturday — no tasks seeded

// IDs captured during setup so assertions can match by id.
let CONSIGNEE_A1: string; // belongs to TENANT_A
let CONSIGNEE_A2: string; // belongs to TENANT_A
let CONSIGNEE_B1: string; // belongs to TENANT_B
const TASK_IDS_A_DAY: string[] = []; // 3 tasks for DAY_WITH_TASKS in TENANT_A
let TASK_ID_B_DAY: string; // 1 task for DAY_WITH_TASKS in TENANT_B (cross-tenant probe)

describe("Day-23 schema-drift pin — listTasksForDayAcrossConsignees", () => {
  beforeAll(async () => {
    await withServiceRole("calendar-day-view integration setup", async (tx) => {
      // Two tenants for cross-tenant coverage.
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, status) VALUES
          (${TENANT_A}, ${SLUG_A}, 'CDV Test A', 'active'),
          (${TENANT_B}, ${SLUG_B}, 'CDV Test B', 'active')
      `);

      // Three consignees: 2 in tenant A (so multi-row ordering can be
      // exercised across distinct consignees), 1 in tenant B (cross-
      // tenant probe).
      CONSIGNEE_A1 = randomUUID();
      CONSIGNEE_A2 = randomUUID();
      CONSIGNEE_B1 = randomUUID();
      await tx.execute(sqlTag`
        INSERT INTO consignees
          (id, tenant_id, name, phone, address_line, emirate_or_region, district, crm_state)
        VALUES
          (${CONSIGNEE_A1}, ${TENANT_A}, 'CDV Alpha', ${`cdv-${RUN_ID}-a-1`},
           'Addr A1', 'Dubai', 'Dubai Marina', 'HIGH_RISK'),
          (${CONSIGNEE_A2}, ${TENANT_A}, 'CDV Beta', ${`cdv-${RUN_ID}-a-2`},
           'Addr A2', 'Dubai', 'Al Quoz', 'ACTIVE'),
          (${CONSIGNEE_B1}, ${TENANT_B}, 'CDV Gamma', ${`cdv-${RUN_ID}-b-1`},
           'Addr B1', 'Dubai', 'Jumeirah', 'ACTIVE')
      `);

      // Three tasks for tenant A on DAY_WITH_TASKS, staggered start
      // times so the ORDER BY assertion has something to verify.
      // Stagger: 08:00, 10:00, 14:00.
      const aTask1 = randomUUID();
      const aTask2 = randomUUID();
      const aTask3 = randomUUID();
      TASK_IDS_A_DAY.push(aTask1, aTask2, aTask3);
      await tx.execute(sqlTag`
        INSERT INTO tasks
          (id, tenant_id, consignee_id, customer_order_number,
           delivery_date, delivery_start_time, delivery_end_time,
           internal_status, external_tracking_number, created_via)
        VALUES
          (${aTask1}, ${TENANT_A}, ${CONSIGNEE_A1}, ${`CDV-A-${RUN_ID}-1`},
           ${DAY_WITH_TASKS}, '08:00', '10:00', 'CREATED', 'AWB-A-001', 'manual_admin'),
          (${aTask2}, ${TENANT_A}, ${CONSIGNEE_A2}, ${`CDV-A-${RUN_ID}-2`},
           ${DAY_WITH_TASKS}, '10:00', '12:00', 'DELIVERED', 'AWB-A-002', 'manual_admin'),
          (${aTask3}, ${TENANT_A}, ${CONSIGNEE_A1}, ${`CDV-A-${RUN_ID}-3`},
           ${DAY_WITH_TASKS}, '14:00', '16:00', 'FAILED', NULL, 'manual_admin')
      `);

      // One task for tenant B on the same date — cross-tenant probe.
      TASK_ID_B_DAY = randomUUID();
      await tx.execute(sqlTag`
        INSERT INTO tasks
          (id, tenant_id, consignee_id, customer_order_number,
           delivery_date, delivery_start_time, delivery_end_time,
           internal_status, external_tracking_number, created_via)
        VALUES
          (${TASK_ID_B_DAY}, ${TENANT_B}, ${CONSIGNEE_B1}, ${`CDV-B-${RUN_ID}-1`},
           ${DAY_WITH_TASKS}, '09:00', '11:00', 'CREATED', 'AWB-B-001', 'manual_admin')
      `);
    });
  });

  // No afterAll teardown — `audit_events_no_delete` RULE on tenants
  // blocks DELETE cascade per memory/followup_audit_rule_cascade_conflict.md.
  // Random per-run UUIDs prevent cross-run collisions.

  it("returns [] when no tasks exist on the given date for the tenant", async () => {
    const result = await withServiceRole("cdv test empty day", async (tx) => {
      return listTasksForDayAcrossConsignees(tx, TENANT_A as Uuid, DAY_EMPTY, {});
    });
    expect(result).toEqual([]);
  });

  it("returns one task for the date with the camelCase domain mapping", async () => {
    // Narrow to one task via the status filter so the assertion is
    // deterministic regardless of seed-order.
    const result = await withServiceRole("cdv test one row", async (tx) => {
      return listTasksForDayAcrossConsignees(tx, TENANT_A as Uuid, DAY_WITH_TASKS, {
        status: "DELIVERED",
      });
    });
    expect(result).toHaveLength(1);
    const row = result[0];
    expect(row.taskId).toBe(TASK_IDS_A_DAY[1]); // 10:00, DELIVERED
    expect(row.consigneeId).toBe(CONSIGNEE_A2);
    expect(row.consigneeName).toBe("CDV Beta");
    expect(row.district).toBe("Al Quoz");
    expect(row.crmState).toBe("ACTIVE");
    expect(row.status).toBe("DELIVERED");
    // The bug being pinned: deliveryWindowStart sourced from
    // tasks.delivery_start_time at the SQL layer. If the broken
    // column reference came back, this query would throw 42703
    // rather than mapping to the camelCase domain field.
    expect(row.deliveryWindowStart).toContain("10:00");
    expect(row.deliveryWindowEnd).toContain("12:00");
    expect(row.externalTrackingNumber).toBe("AWB-A-002");
    expect(row.subscriptionId).toBeNull();
  });

  it("returns three rows for the date ordered by delivery_start_time ASC", async () => {
    const result = await withServiceRole("cdv test three rows", async (tx) => {
      return listTasksForDayAcrossConsignees(tx, TENANT_A as Uuid, DAY_WITH_TASKS, {});
    });
    expect(result).toHaveLength(3);
    // Ordered 08:00 → 10:00 → 14:00 per ORDER BY clause.
    expect(result[0].deliveryWindowStart).toContain("08:00");
    expect(result[1].deliveryWindowStart).toContain("10:00");
    expect(result[2].deliveryWindowStart).toContain("14:00");
    // Order also pins the task ids in seeded order.
    expect(result.map((r) => r.taskId)).toEqual(TASK_IDS_A_DAY);
  });

  it("never surfaces tasks from another tenant (tenant predicate)", async () => {
    const result = await withServiceRole("cdv test cross-tenant", async (tx) => {
      return listTasksForDayAcrossConsignees(tx, TENANT_A as Uuid, DAY_WITH_TASKS, {});
    });
    // Tenant-A returns 3 rows; tenant-B's task on the same date is
    // excluded by the `t.tenant_id = ${tenantId}` predicate in
    // buildFilterClause.
    expect(result.find((r) => r.taskId === TASK_ID_B_DAY)).toBeUndefined();
  });

  it("filters by crm_state on the consignee join", async () => {
    const result = await withServiceRole("cdv test crm filter", async (tx) => {
      return listTasksForDayAcrossConsignees(tx, TENANT_A as Uuid, DAY_WITH_TASKS, {
        crm: "HIGH_RISK",
      });
    });
    // Two of the three seeded tasks are for CONSIGNEE_A1 which is
    // HIGH_RISK; the third is for CONSIGNEE_A2 (ACTIVE).
    expect(result).toHaveLength(2);
    for (const row of result) {
      expect(row.crmState).toBe("HIGH_RISK");
      expect(row.consigneeId).toBe(CONSIGNEE_A1);
    }
  });
});
