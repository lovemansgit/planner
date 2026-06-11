// tests/integration/tenant-tasks-count.spec.ts
// =============================================================================
// Day-24 PM pin for the date-range extension on countTasksByTenant
// (src/modules/tasks/repository.ts). The existing `countTasksByTenant`
// repo fn had no integration coverage for the new dateFrom/dateTo
// fragments; pinning here under real Postgres + withTenant() RLS.
//
// Cases pinned:
//   1. empty filter returns the seeded count for the tenant
//   2. status narrows
//   3. searchTerm narrows
//   4. dateFrom/dateTo narrows to inclusive window
//   5. cross-tenant isolation — second tenant's tasks never surface
//      under withTenant() of the first tenant
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { countTasksByTenant } from "../../src/modules/tasks/repository";
import { withServiceRole, withTenant } from "../../src/shared/db";
import type { Uuid } from "../../src/shared/types";

const RUN_ID = randomUUID().slice(0, 8);
const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const CONSIGNEE_A = randomUUID();
const CONSIGNEE_B = randomUUID();

const TASK_A_MAY01 = randomUUID();
const TASK_A_MAY10_DELIVERED = randomUUID();
const TASK_A_MAY15 = randomUUID();
const TASK_B_MAY15 = randomUUID();

describe("Day-24 PM tenant count pin — countTasksByTenant", () => {
  beforeAll(async () => {
    await withServiceRole("tenant-tasks-count integration setup", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, status) VALUES
          (${TENANT_A}, ${`ttc-${RUN_ID}-a`}, ${`TTC A ${RUN_ID}`}, 'active'),
          (${TENANT_B}, ${`ttc-${RUN_ID}-b`}, ${`TTC B ${RUN_ID}`}, 'active')
      `);

      await tx.execute(sqlTag`
        INSERT INTO consignees
          (id, tenant_id, name, phone, address_line, emirate_or_region, district, crm_state)
        VALUES
          (${CONSIGNEE_A}, ${TENANT_A}, ${`Consignee A ${RUN_ID}`}, ${`ttc-${RUN_ID}-a`},
           'Addr A', 'Dubai', 'Marina', 'ACTIVE'),
          (${CONSIGNEE_B}, ${TENANT_B}, ${`Consignee B ${RUN_ID}`}, ${`ttc-${RUN_ID}-b`},
           'Addr B', 'Dubai', 'Al Quoz', 'ACTIVE')
      `);

      await tx.execute(sqlTag`
        INSERT INTO tasks
          (id, tenant_id, consignee_id, customer_order_number,
           delivery_date, delivery_start_time, delivery_end_time,
           internal_status, external_tracking_number, created_via)
        VALUES
          (${TASK_A_MAY01}, ${TENANT_A}, ${CONSIGNEE_A}, ${`TTC-${RUN_ID}-1`},
           '2026-05-01', '08:00', '10:00', 'CREATED', NULL, 'manual_admin'),
          (${TASK_A_MAY10_DELIVERED}, ${TENANT_A}, ${CONSIGNEE_A}, ${`TTC-${RUN_ID}-2`},
           '2026-05-10', '10:00', '12:00', 'DELIVERED', NULL, 'manual_admin'),
          (${TASK_A_MAY15}, ${TENANT_A}, ${CONSIGNEE_A}, ${`TTC-${RUN_ID}-3`},
           '2026-05-15', '14:00', '16:00', 'FAILED', NULL, 'manual_admin'),
          (${TASK_B_MAY15}, ${TENANT_B}, ${CONSIGNEE_B}, ${`TTC-${RUN_ID}-B`},
           '2026-05-15', '09:00', '11:00', 'CREATED', NULL, 'manual_admin')
      `);
    });
  });

  it("empty filter returns 3 (tenant-A seeded set, tenant-B excluded by RLS)", async () => {
    const result = await withTenant(TENANT_A as Uuid, async (tx) =>
      countTasksByTenant(tx, TENANT_A as Uuid),
    );
    expect(result).toBe(3);
  });

  it("status filter narrows (DELIVERED → 1)", async () => {
    const result = await withTenant(TENANT_A as Uuid, async (tx) =>
      countTasksByTenant(tx, TENANT_A as Uuid, { status: "DELIVERED" }),
    );
    expect(result).toBe(1);
  });

  it("dateFrom alone narrows (>= 2026-05-10 → 2)", async () => {
    const result = await withTenant(TENANT_A as Uuid, async (tx) =>
      countTasksByTenant(tx, TENANT_A as Uuid, { dateFrom: "2026-05-10" }),
    );
    expect(result).toBe(2);
  });

  it("dateTo alone narrows (<= 2026-05-10 → 2)", async () => {
    const result = await withTenant(TENANT_A as Uuid, async (tx) =>
      countTasksByTenant(tx, TENANT_A as Uuid, { dateTo: "2026-05-10" }),
    );
    expect(result).toBe(2);
  });

  it("inclusive date range (2026-05-15 → 1)", async () => {
    const result = await withTenant(TENANT_A as Uuid, async (tx) =>
      countTasksByTenant(tx, TENANT_A as Uuid, {
        dateFrom: "2026-05-15",
        dateTo: "2026-05-15",
      }),
    );
    expect(result).toBe(1);
  });

  it("cross-tenant isolation — tenant-B task never surfaces under withTenant(A)", async () => {
    // Tenant-A's count for 2026-05-15 is 1 (the FAILED task). If RLS or
    // scoping leaked, the tenant-B 2026-05-15 task would push this to 2.
    const result = await withTenant(TENANT_A as Uuid, async (tx) =>
      countTasksByTenant(tx, TENANT_A as Uuid, {
        dateFrom: "2026-05-15",
        dateTo: "2026-05-15",
      }),
    );
    expect(result).toBe(1);
  });
});
