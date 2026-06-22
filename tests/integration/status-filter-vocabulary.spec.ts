// tests/integration/status-filter-vocabulary.spec.ts
// =============================================================================
// D57 Items B/C — status filter vocabulary + ON_HOLD suppression (real Postgres).
//
// Exercised through listAllTasksRows (the admin path, which uses the shared
// buildCourierStatusFilter) scoped to a unique genuine-tenant slug so the
// cross-tenant query returns only this fixture's rows.
//
//   Item B: ?status=CREATED matches NULL-courier internal_status='CREATED' rows
//           (coarse fallback) — CREATED is a real, selectable, non-zero filter.
//   Item C: ?status=ON_HOLD returns ZERO (legacy ON_HOLD rows are All-only); the
//           ON_HOLD row is nonetheless present in the unfiltered list.
//
// RED under the pre-fix helper (which matched ON_HOLD via the coarse fallback →
// 1 row); GREEN under the ON_HOLD-suppressing helper → 0. No teardown (random
// per-run slug; audit_events_no_delete blocks tenant DELETE).
//
// Genuine-tenant note: slug has no 8-hex run, so buildGenuineTenantsFilter
// admits it (active, non-test-pattern) — required for the admin query to see it.
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { withServiceRole } from "../../src/shared/db";
import { listAllTasksRows } from "../../src/modules/tasks/repository";
import type { TaskStatusFilter } from "../../src/modules/tasks";

const RUN = randomUUID().slice(0, 4); // ≤4 hex chars → no 8-hex test-tenant run
const TENANT = randomUUID();
const SLUG = `onhold-bc-${RUN}`;
const DEL = "2026-05-01";

const SEED = { CREATED: 2, ON_HOLD: 1, DELIVERED: 1 } as const;
const TOTAL = SEED.CREATED + SEED.ON_HOLD + SEED.DELIVERED;

describe("D57 Items B/C — status filter vocabulary + ON_HOLD suppression (real DB)", () => {
  beforeAll(async () => {
    await withServiceRole("sfv setup", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, status)
        VALUES (${TENANT}, ${SLUG}, 'SFV Test', 'active')`);
      const consignee = randomUUID();
      await tx.execute(sqlTag`
        INSERT INTO consignees (id, tenant_id, name, phone, address_line, emirate_or_region, district)
        VALUES (${consignee}, ${TENANT}, 'SFV Consignee', ${`sfv-${RUN}-1`}, 'Addr', 'Dubai', 'D')`);
      let i = 0;
      const ins = async (internal: string) => {
        await tx.execute(sqlTag`
          INSERT INTO tasks (
            id, tenant_id, consignee_id, customer_order_number,
            delivery_date, delivery_start_time, delivery_end_time, created_via,
            internal_status, courier_status
          ) VALUES (
            ${randomUUID()}, ${TENANT}, ${consignee}, ${`SFV-${RUN}-${i++}`},
            ${DEL}, '14:00', '16:00', 'manual_admin', ${internal}, NULL
          )`);
      };
      for (let n = 0; n < SEED.CREATED; n++) await ins("CREATED");
      for (let n = 0; n < SEED.ON_HOLD; n++) await ins("ON_HOLD");
      for (let n = 0; n < SEED.DELIVERED; n++) await ins("DELIVERED");
    });
  });

  const admin = (status: TaskStatusFilter | undefined) =>
    withServiceRole("sfv list", (tx) => listAllTasksRows(tx, { merchantSlug: SLUG, status }));

  it("Item B — CREATED matches its NULL-courier rows via the coarse fallback", async () => {
    expect((await admin("CREATED")).length).toBe(SEED.CREATED);
  });

  it("Item C — ON_HOLD returns ZERO (legacy ON_HOLD rows are All-only)", async () => {
    expect((await admin("ON_HOLD")).length).toBe(0);
  });

  it("Item C — the ON_HOLD row IS present in the unfiltered (All) list", async () => {
    const all = await admin(undefined);
    expect(all.length).toBe(TOTAL);
    expect(all.some((r) => r.task.internalStatus === "ON_HOLD")).toBe(true);
  });

  it("DELIVERED still matches via the coarse fallback (sanity)", async () => {
    expect((await admin("DELIVERED")).length).toBe(SEED.DELIVERED);
  });
});
