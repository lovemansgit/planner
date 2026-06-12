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
  getAdminAllMerchantsInventoryReport,
  getAdminAssetTrackingReport,
  getAssetScanLog,
  getInventoryReport,
  refreshMerchantAssetTracking,
  refreshTenantAssetTracking,
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
// Lit but EMPTY — pins the F1 all-merchants rule that a lit merchant
// with no asset data still gets a section (rollup null, zeros render).
const TENANT_EMPTY = randomUUID() as Uuid;
const SLUG_ON = `p2-agg-${RUN_ID}-on`;
const SLUG_OFF = `p2-agg-${RUN_ID}-off`;
const SLUG_EMPTY = `p2-agg-${RUN_ID}-empty`;

const DATE_1 = "2026-06-10";
const DATE_2 = "2026-06-11";
// Per-run AWB digits: tracking_id is GLOBALLY unique (0011), so fixed
// AWBs collide when a prior run's teardown was interrupted. Digits
// derive from the run's uuid.
const RUN_NUM = String(Number.parseInt(RUN_ID.replace(/[^0-9a-f]/g, "").slice(0, 6) || "1", 16) % 900000 + 100000);
const AWB_1 = `MPL-9${RUN_NUM}1`; // tenant ON, date 1, consignee 1 — 2 pkgs
const AWB_2 = `MPL-9${RUN_NUM}2`; // tenant ON, date 2, consignee 2 — 1 pkg
const AWB_OFF = `MPL-9${RUN_NUM}9`; // tenant OFF — must never surface

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
          (${TENANT_OFF}, ${SLUG_OFF}, 'P2 Agg OFF', true),
          (${TENANT_EMPTY}, ${SLUG_EMPTY}, 'P2 Agg Empty', true)
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
        await tx.execute(sqlTag`DELETE FROM asset_scan_log WHERE tenant_id IN (${TENANT_ON}, ${TENANT_OFF}, ${TENANT_EMPTY})`);
        // Explicit child deletes — the tenants cascade is known-blocked
        // by the 0002 audit no-delete RULE when audit rows exist, and a
        // failed cascade would strand globally-unique tracking_ids.
        await tx.execute(sqlTag`DELETE FROM asset_tracking_cache WHERE tenant_id IN (${TENANT_ON}, ${TENANT_OFF})`);
        await tx.execute(sqlTag`DELETE FROM tasks WHERE tenant_id IN (${TENANT_ON}, ${TENANT_OFF})`);
        await tx.execute(sqlTag`DELETE FROM tenants WHERE id IN (${TENANT_ON}, ${TENANT_OFF}, ${TENANT_EMPTY})`);
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

  it("all-merchants inventory: one section per lit merchant, dark merchant absent, empty lit merchant present (Day-54 walk F1)", async () => {
    const report = await getAdminAllMerchantsInventoryReport(makeCtx(SYSADMIN_PERMS), {
      dateFrom: DATE_1,
      dateTo: DATE_2,
    });

    expect(report.sections.some((s) => s.tenantId === TENANT_OFF)).toBe(false);

    const on = report.sections.find((s) => s.tenantId === TENANT_ON);
    expect(on).toBeDefined();
    expect(on?.merchantSlug).toBe(SLUG_ON);
    expect(on?.rollup).toMatchObject({
      allocatedAssets: 3,
      suppQuantity: 3,
      collected: 1,
      sorted: 1,
      returned: 1,
    });
    expect([...(on?.rollup?.awbs ?? [])].sort()).toEqual([AWB_1, AWB_2]);
    expect(on?.rollup?.awbsByState.returned).toEqual([AWB_2]);
    // The by-consignee breakdown carries both consignees' rows.
    expect(new Set(on?.consignees.map((r) => r.consigneeId))).toEqual(
      new Set([consignee1, consignee2]),
    );

    // Lit but empty: section present, rollup null, no consignee rows.
    const empty = report.sections.find((s) => s.tenantId === TENANT_EMPTY);
    expect(empty).toBeDefined();
    expect(empty?.rollup).toBeNull();
    expect(empty?.consignees).toHaveLength(0);

    // Gate: read_all required.
    await expect(
      getAdminAllMerchantsInventoryReport(
        makeCtx(new Set<Permission>(["asset_tracking:read"])),
        { dateFrom: DATE_1, dateTo: DATE_2 },
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
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

  it("asset log: returns seeded scan lines newest-first with the recorded-in-Planner fallback", async () => {
    // Seed two scan-log lines for AWB_1 out of order.
    await withServiceRole("P2 scan-log seed", async (tx) => {
      const taskRows = await tx.execute<{ id: string } & Record<string, unknown>>(sqlTag`
        SELECT id FROM tasks WHERE external_tracking_number = ${AWB_1} AND tenant_id = ${TENANT_ON}
      `);
      const taskId = taskRows[0].id;
      await tx.execute(sqlTag`
        INSERT INTO asset_scan_log (tenant_id, task_id, tracking_id, awb, state, received_at, scanned_by, source)
        VALUES
          (${TENANT_ON}, ${taskId}, ${`${AWB_1}-1`}, ${AWB_1}, 'COLLECTED', '2026-06-10T08:00:00Z', ${sqlTag`'{"name":"Courier A"}'::jsonb`}, 'poll'),
          (${TENANT_ON}, ${taskId}, ${`${AWB_1}-1`}, ${AWB_1}, 'SORTED', '2026-06-10T12:00:00Z', NULL, 'poll')
      `);
    });

    const lines = await getAssetScanLog(makeCtx(SYSADMIN_PERMS), { awbs: [AWB_1] });
    expect(lines).toHaveLength(2);
    expect(lines[0].state).toBe("SORTED");
    expect(lines[1].state).toBe("COLLECTED");
    expect(lines[1].scannedByName).toBe("Courier A");
    // vendor_scanned_at is NULL (SF doesn't ship scan times yet) →
    // the display fallback is receivedAt.
    expect(lines[0].vendorScannedAt).toBeNull();
    expect(lines[0].receivedAt).toBe("2026-06-10T12:00:00.000Z");
  });

  it("asset log: rejects malformed AWBs and non-read_all actors", async () => {
    await expect(
      getAssetScanLog(makeCtx(SYSADMIN_PERMS), { awbs: ["MPL-123','x" as string] }),
    ).rejects.toThrow();
    await expect(
      getAssetScanLog(makeCtx(new Set<Permission>(["asset_tracking:read"])), { awbs: [AWB_1] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("manual refresh: dark tenant + unknown merchant are refused before any SF call", async () => {
    // TENANT_OFF's operator: flag off → ForbiddenError.
    await expect(
      refreshTenantAssetTracking(
        makeCtx(new Set<Permission>(["asset_tracking:read"]), TENANT_OFF),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    // Admin refreshing the dark merchant: refused, not silently skipped.
    await expect(
      refreshMerchantAssetTracking(makeCtx(SYSADMIN_PERMS), SLUG_OFF),
    ).rejects.toBeInstanceOf(ForbiddenError);
    // Unknown merchant: NotFound → throws.
    await expect(
      refreshMerchantAssetTracking(makeCtx(SYSADMIN_PERMS), `no-such-${RUN_ID}`),
    ).rejects.toThrow();
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
