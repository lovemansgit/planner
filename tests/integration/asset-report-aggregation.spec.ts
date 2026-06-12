// tests/integration/asset-report-aggregation.spec.ts
// =============================================================================
// Day-54 P2 — report aggregation correctness + scoping (real Postgres).
//
// Seeds two tenants (one dark-switch ON, one OFF), tasks across two
// delivery dates and two consignees, and cache rows across states with
// supplementary quantities. Pins:
//   1. Admin report counts/sums per merchant × date, and ONLY enabled
//      tenants appear (the dark switch scopes the fleet view).
//   2. Inventory by-date and by-consignee agree with each other and
//      with the seeded arithmetic (Allocated = bag count, Supp. Qty =
//      ice-pack sum — Aqib's confirmed semantics).
//   3. Per-state AWB sets carry exactly the AWBs behind each value.
//   4. The tasks-page drill-down filter (`awbs`) returns exactly the
//      set's rows (listTasksByTenant + countTasksByTenant).
//   5. Permission gates: no asset_tracking:read_all → ForbiddenError
//      on the admin report; no asset_tracking:read → ForbiddenError on
//      the tenant report.
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { beforeAll, afterAll, describe, expect, it } from "vitest";

import {
  getAdminAssetTrackingReport,
  getInventoryReport,
} from "../../src/modules/asset-tracking/report-service";
import { ROLES } from "../../src/modules/identity";
import {
  countTasksByTenant,
  listTasksByTenant,
} from "../../src/modules/tasks/repository";
import { withServiceRole, withTenant } from "../../src/shared/db";
import { ForbiddenError } from "../../src/shared/errors";
import type { RequestContext } from "../../src/shared/tenant-context";
import type { Permission, Uuid } from "../../src/shared/types";

const RUN_ID = randomUUID().slice(0, 8);
const TENANT_ON = randomUUID() as Uuid;
const TENANT_OFF = randomUUID() as Uuid;
const SLUG_ON = `p2-agg-${RUN_ID}-on`;
const SLUG_OFF = `p2-agg-${RUN_ID}-off`;

const DATE_1 = "2026-06-10";
const DATE_2 = "2026-06-11";
const AWB_1 = "MPL-91000001"; // tenant ON, date 1, consignee 1 — 2 pkgs
const AWB_2 = "MPL-91000002"; // tenant ON, date 2, consignee 2 — 1 pkg
const AWB_OFF = "MPL-91000009"; // tenant OFF — must never surface

const SYSADMIN_PERMS = ROLES["transcorp-sysadmin"].permissions;

function makeCtx(
  perms: ReadonlySet<Permission>,
  tenantId: Uuid = TENANT_ON,
): RequestContext {
  return {
    actor: {
      kind: "user",
      userId: "ffffffff-ffff-ffff-ffff-ffffffffffff",
      tenantId,
      permissions: perms,
    },
    tenantId,
    requestId: randomUUID(),
    path: "/reports/inventory",
  };
}

let consignee1: Uuid;
let consignee2: Uuid;

describe("Day-54 P2 — asset report aggregation (real Postgres)", () => {
  beforeAll(async () => {
    await withServiceRole("P2 aggregation setup", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, task_asset_tracking_enabled) VALUES
          (${TENANT_ON}, ${SLUG_ON}, 'P2 Agg ON', true),
          (${TENANT_OFF}, ${SLUG_OFF}, 'P2 Agg OFF', true)
      `);
      // The OFF tenant's flag flips off AFTER insert to prove the
      // admin query reads the column, not the insert default.
      await tx.execute(sqlTag`
        UPDATE tenants SET task_asset_tracking_enabled = false WHERE id = ${TENANT_OFF}
      `);

      type IdRow = { id: string } & Record<string, unknown>;
      const c1 = await tx.execute<IdRow>(sqlTag`
        INSERT INTO consignees (tenant_id, name, phone, address_line, emirate_or_region, district)
        VALUES (${TENANT_ON}, 'P2 Consignee One', ${`p2-${RUN_ID}-1`}, 'Addr', 'Dubai', 'D1')
        RETURNING id
      `);
      consignee1 = c1[0].id as Uuid;
      const c2 = await tx.execute<IdRow>(sqlTag`
        INSERT INTO consignees (tenant_id, name, phone, address_line, emirate_or_region, district)
        VALUES (${TENANT_ON}, 'P2 Consignee Two', ${`p2-${RUN_ID}-2`}, 'Addr', 'Dubai', 'D2')
        RETURNING id
      `);
      consignee2 = c2[0].id as Uuid;
      const cOff = await tx.execute<IdRow>(sqlTag`
        INSERT INTO consignees (tenant_id, name, phone, address_line, emirate_or_region, district)
        VALUES (${TENANT_OFF}, 'P2 Consignee Off', ${`p2-${RUN_ID}-9`}, 'Addr', 'Dubai', 'D9')
        RETURNING id
      `);

      async function seedTask(
        tenantId: Uuid,
        consigneeId: string,
        date: string,
        awb: string,
      ): Promise<string> {
        const rows = await tx.execute<IdRow>(sqlTag`
          INSERT INTO tasks (
            tenant_id, consignee_id, customer_order_number,
            delivery_date, delivery_start_time, delivery_end_time,
            created_via, external_tracking_number
          ) VALUES (
            ${tenantId}, ${consigneeId}, ${`P2-${RUN_ID}-${awb}`},
            ${date}, '14:00', '16:00', 'manual_admin', ${awb}
          )
          RETURNING id
        `);
        return rows[0].id;
      }

      const task1 = await seedTask(TENANT_ON, consignee1, DATE_1, AWB_1);
      const task2 = await seedTask(TENANT_ON, consignee2, DATE_2, AWB_2);
      const taskOff = await seedTask(TENANT_OFF, cOff[0].id, DATE_1, AWB_OFF);

      async function seedCache(
        tenantId: Uuid,
        taskId: string,
        trackingId: string,
        state: string,
        suppQty: number | null,
      ): Promise<void> {
        await tx.execute(sqlTag`
          INSERT INTO asset_tracking_cache (
            task_id, task_id_external, external_record_id,
            tracking_id, type, state, supplementary_quantity, tenant_id
          ) VALUES (
            ${taskId}, 90001, ${Math.floor(Math.random() * 1_000_000)},
            ${trackingId}, 'BAGS', ${state}, ${suppQty}, ${tenantId}
          )
        `);
      }

      // Tenant ON / date 1 / consignee 1: 2 bags (COLLECTED + SORTED), 3 ice packs.
      await seedCache(TENANT_ON, task1, `${AWB_1}-1`, "COLLECTED", 2);
      await seedCache(TENANT_ON, task1, `${AWB_1}-2`, "SORTED", 1);
      // Tenant ON / date 2 / consignee 2: 1 bag RETURNED, no ice packs.
      await seedCache(TENANT_ON, task2, `${AWB_2}-1`, "RETURNED", null);
      // Tenant OFF: 1 bag — must never appear in the admin report.
      await seedCache(TENANT_OFF, taskOff, `${AWB_OFF}-1`, "COLLECTED", 5);
    });
  });

  afterAll(async () => {
    try {
      await withServiceRole("P2 aggregation teardown", async (tx) => {
        await tx.execute(sqlTag`SET LOCAL app.allow_scan_log_delete = 'on'`);
        await tx.execute(sqlTag`DELETE FROM asset_scan_log WHERE tenant_id IN (${TENANT_ON}, ${TENANT_OFF})`);
        await tx.execute(sqlTag`DELETE FROM tenants WHERE id IN (${TENANT_ON}, ${TENANT_OFF})`);
      });
    } catch {
      // Cleanup failure is not test failure.
    }
  });

  it("admin report: merchant × date arithmetic + dark-switch scoping", async () => {
    const report = await getAdminAssetTrackingReport(makeCtx(SYSADMIN_PERMS), {
      dateFrom: DATE_1,
      dateTo: DATE_2,
      merchantSlug: undefined,
    });

    const mine = report.rows.filter((r) => r.tenantId === TENANT_ON);
    expect(mine).toHaveLength(2);
    expect(report.rows.some((r) => r.tenantId === TENANT_OFF)).toBe(false);

    const day1 = mine.find((r) => r.deliveryDate === DATE_1);
    expect(day1).toMatchObject({
      collected: 1,
      sorted: 1,
      returned: 0,
      allocatedAssets: 2,
      suppQuantity: 3,
    });
    expect(day1?.awbs).toEqual([AWB_1]);
    expect(day1?.awbsByState.collected).toEqual([AWB_1]);
    expect(day1?.awbsByState.returned).toEqual([]);

    const day2 = mine.find((r) => r.deliveryDate === DATE_2);
    expect(day2).toMatchObject({
      returned: 1,
      allocatedAssets: 1,
      suppQuantity: 0,
    });
  });

  it("inventory report: by-date and by-consignee sections agree with the seed", async () => {
    const ctx = makeCtx(new Set<Permission>(["asset_tracking:read"]));
    const report = await getInventoryReport(ctx, { dateFrom: DATE_1, dateTo: DATE_2 });

    expect(report.byDate).toHaveLength(2);
    const byDateTotals = report.byDate.reduce((sum, r) => sum + r.allocatedAssets, 0);
    const byConsTotals = report.byConsignee.reduce((sum, r) => sum + r.allocatedAssets, 0);
    expect(byDateTotals).toBe(3);
    expect(byConsTotals).toBe(3);

    const cons1 = report.byConsignee.find((r) => r.consigneeId === consignee1);
    expect(cons1).toMatchObject({
      consigneeName: "P2 Consignee One",
      deliveryDate: DATE_1,
      allocatedAssets: 2,
      suppQuantity: 3,
      collected: 1,
      sorted: 1,
    });
  });

  it("tasks drill-down: the awbs filter returns exactly the set's rows", async () => {
    const rows = await withTenant(TENANT_ON, async (tx) =>
      listTasksByTenant(tx, TENANT_ON, { awbs: [AWB_1, AWB_2] }),
    );
    expect(rows.map((r) => r.externalTrackingNumber).sort()).toEqual([AWB_1, AWB_2]);

    const count = await withTenant(TENANT_ON, async (tx) =>
      countTasksByTenant(tx, TENANT_ON, { awbs: [AWB_1] }),
    );
    expect(count).toBe(1);
  });

  it("permission gates: missing read_all / read → ForbiddenError", async () => {
    await expect(
      getAdminAssetTrackingReport(makeCtx(new Set<Permission>(["task:read"])), {
        dateFrom: DATE_1,
        dateTo: DATE_2,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      getInventoryReport(makeCtx(new Set<Permission>(["task:read"])), {
        dateFrom: DATE_1,
        dateTo: DATE_2,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
