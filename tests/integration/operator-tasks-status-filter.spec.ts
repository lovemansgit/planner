// tests/integration/operator-tasks-status-filter.spec.ts
// =============================================================================
// D57 Item A — operator /tasks status filter, render-aligned (real Postgres).
//
// The operator list/count carried the same courier_status-only predicate that
// broke /admin/tasks (#554): with 100% of rows at courier_status NULL, every
// specific filter returned 0 while rows rendered their status from the coarse
// internal_status fallback. buildCourierStatusFilter (the shared #554 helper)
// now matches courier_status when present, else the coarse value the row
// actually carries.
//
// This is the regression-grade signal the unit (mocked-SQL) test cannot give:
// it proves each status filter returns its expected NON-ZERO set against the
// real engine. Under the pre-fix predicate every assertion below returns 0
// (RED); under the fix they return the seeded counts (GREEN).
//
// No teardown — `audit_events_no_delete` blocks tenant DELETE cascade; random
// per-run UUIDs prevent cross-run collisions (matches list-visible-task-ids).
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { withServiceRole } from "../../src/shared/db";
import {
  listTasksByTenant,
  countTasksByTenant,
  listAllTaskIdsByTenant,
} from "../../src/modules/tasks/repository";
import type { CourierStatus } from "../../src/modules/integration";
import type { Uuid } from "../../src/shared/types";

const RUN = randomUUID().slice(0, 8);
const TENANT = randomUUID();
const SLUG = `ostf-${RUN}`;
const DEL = "2026-05-01";

// NULL-courier rows that render via the coarse internal_status fallback…
const COARSE = { DELIVERED: 3, FAILED: 2, CREATED: 1 } as const;
// …plus one row with a real FINE courier_status (proves fine matching too).
const FINE_OFD = 1; // courier_status='OUT_FOR_DELIVERY', internal_status='IN_TRANSIT'
const TOTAL = COARSE.DELIVERED + COARSE.FAILED + COARSE.CREATED + FINE_OFD;

describe("D57 Item A — operator /tasks status filter (render-aligned, real DB)", () => {
  beforeAll(async () => {
    await withServiceRole("ostf setup", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, status)
        VALUES (${TENANT}, ${SLUG}, 'OSTF Test', 'active')`);
      const consignee = randomUUID();
      await tx.execute(sqlTag`
        INSERT INTO consignees (id, tenant_id, name, phone, address_line, emirate_or_region, district)
        VALUES (${consignee}, ${TENANT}, 'OSTF Consignee', ${`ostf-${RUN}-1`}, 'Addr', 'Dubai', 'D')`);
      let i = 0;
      const ins = async (internal: string, courier: string | null) => {
        await tx.execute(sqlTag`
          INSERT INTO tasks (
            id, tenant_id, consignee_id, customer_order_number,
            delivery_date, delivery_start_time, delivery_end_time, created_via,
            internal_status, courier_status
          ) VALUES (
            ${randomUUID()}, ${TENANT}, ${consignee}, ${`OSTF-${RUN}-${i++}`},
            ${DEL}, '14:00', '16:00', 'manual_admin', ${internal}, ${courier}
          )`);
      };
      for (let n = 0; n < COARSE.DELIVERED; n++) await ins("DELIVERED", null);
      for (let n = 0; n < COARSE.FAILED; n++) await ins("FAILED", null);
      for (let n = 0; n < COARSE.CREATED; n++) await ins("CREATED", null);
      for (let n = 0; n < FINE_OFD; n++) await ins("IN_TRANSIT", "OUT_FOR_DELIVERY");
    });
  });

  const list = (status: CourierStatus | undefined) =>
    withServiceRole("ostf list", (tx) => listTasksByTenant(tx, TENANT as Uuid, { status }));
  const count = (status: CourierStatus | undefined) =>
    withServiceRole("ostf count", (tx) => countTasksByTenant(tx, TENANT as Uuid, { status }));

  it("DELIVERED (NULL-courier, coarse fallback) returns the 3 rows — was 0 pre-fix", async () => {
    expect((await list("DELIVERED")).length).toBe(COARSE.DELIVERED);
    expect(await count("DELIVERED")).toBe(COARSE.DELIVERED);
  });

  it("FAILED (coarse fallback) returns the 2 rows", async () => {
    expect((await list("FAILED")).length).toBe(COARSE.FAILED);
    expect(await count("FAILED")).toBe(COARSE.FAILED);
  });

  it("OUT_FOR_DELIVERY (real fine courier_status) returns the 1 fine row", async () => {
    expect((await list("OUT_FOR_DELIVERY")).length).toBe(FINE_OFD);
    expect(await count("OUT_FOR_DELIVERY")).toBe(FINE_OFD);
  });

  it("unfiltered (All) returns every seeded row", async () => {
    expect((await list(undefined)).length).toBe(TOTAL);
    expect(await count(undefined)).toBe(TOTAL);
  });

  // D57 incomplete-parity fix — "select all <status>" (the label-print id list)
  // must return the SAME ids the visible filtered list shows. Pre-fix this path
  // matched courier_status only → selected 0 on NULL-courier rows while the list
  // showed rows (list/action divergence). Non-zero + set-equal under the fix.
  it("select-all id set EQUALS the visible list under a coarse-fallback status (DELIVERED)", async () => {
    const visibleIds = (await list("DELIVERED")).map((t) => t.id).sort();
    const selectAllIds = [
      ...(await withServiceRole("ostf ids", (tx) =>
        listAllTaskIdsByTenant(tx, TENANT as Uuid, { status: "DELIVERED" }),
      )),
    ].sort();
    expect(selectAllIds.length).toBe(COARSE.DELIVERED); // non-zero on NULL-courier rows
    expect(selectAllIds).toEqual(visibleIds);
  });
});
