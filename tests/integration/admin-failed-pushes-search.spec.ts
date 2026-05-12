// tests/integration/admin-failed-pushes-search.spec.ts
// =============================================================================
// Day-24 schema-drift regression pin for listUnresolvedByTenant
// searchTerm path (src/modules/failed-pushes/repository.ts).
//
// Bug class: the admin search path adds a new
//   INNER JOIN tasks t ON t.id = fp.task_id
// to a previously single-table query, and ILIKEs against
// `t.external_tracking_number` + `fp.task_id::text`. The INNER JOIN is
// structurally safe — `failed_pushes.task_id REFERENCES tasks(id) ON
// DELETE CASCADE` (0008_failed_pushes.sql:140) plus the BEFORE-INSERT
// trigger `failed_pushes_assert_tenant_match` (0008:211) make orphan
// failed_pushes impossible. Unit specs with mocked `tx.execute` cannot
// prove the JOIN binds + the UUID-to-text cast operates correctly
// under real Postgres.
//
// Cases pinned:
//   1. No searchTerm → returns the seeded unresolved row
//   2. AWB match (parent task carries external_tracking_number)
//   3. Partial UUID match on fp.task_id::text
//   4. No-match returns empty
//   5. Single-tenant scoping enforced — second tenant's row never surfaces
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { listUnresolvedByTenant } from "../../src/modules/failed-pushes/repository";
import { withServiceRole, withTenant } from "../../src/shared/db";
import type { Uuid } from "../../src/shared/types";

const RUN_ID = randomUUID().slice(0, 8);
const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const SLUG_A = `afp-${RUN_ID}-alpha`;
const SLUG_B = `afp-${RUN_ID}-bravo`;

const CONSIGNEE_A = randomUUID();
const CONSIGNEE_B = randomUUID();

// Two parent tasks under tenant A — one carries an AWB (reconciled-via-AWB
// scenario), one does not. Tenant B has one parent task.
const TASK_A_WITH_AWB = randomUUID();
const TASK_A_NO_AWB = randomUUID();
const TASK_B = randomUUID();

const AWB_A = `AFP-AWB-${RUN_ID}`;

let FP_A_WITH_AWB: string;
let FP_A_NO_AWB: string;
let FP_B: string;

describe("Day-24 failed-pushes admin search — listUnresolvedByTenant", () => {
  beforeAll(async () => {
    await withServiceRole("admin-failed-pushes-search integration setup", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, status) VALUES
          (${TENANT_A}, ${SLUG_A}, ${`AFP Alpha ${RUN_ID}`}, 'active'),
          (${TENANT_B}, ${SLUG_B}, ${`AFP Bravo ${RUN_ID}`}, 'active')
      `);

      await tx.execute(sqlTag`
        INSERT INTO consignees
          (id, tenant_id, name, phone, address_line, emirate_or_region, district, crm_state)
        VALUES
          (${CONSIGNEE_A}, ${TENANT_A}, ${`AFP Consignee A ${RUN_ID}`}, ${`afp-${RUN_ID}-a`},
           'Addr A', 'Dubai', 'Marina', 'ACTIVE'),
          (${CONSIGNEE_B}, ${TENANT_B}, ${`AFP Consignee B ${RUN_ID}`}, ${`afp-${RUN_ID}-b`},
           'Addr B', 'Dubai', 'Al Quoz', 'ACTIVE')
      `);

      // Parent tasks. One under tenant A carries AWB (reconciled-via-AWB
      // shape — task has external_tracking_number set). The other does not.
      await tx.execute(sqlTag`
        INSERT INTO tasks
          (id, tenant_id, consignee_id, customer_order_number,
           delivery_date, delivery_start_time, delivery_end_time,
           internal_status, external_tracking_number, created_via)
        VALUES
          (${TASK_A_WITH_AWB}, ${TENANT_A}, ${CONSIGNEE_A}, ${`AFP-ORD-${RUN_ID}-A1`},
           '2026-05-15', '08:00', '10:00', 'DELIVERED', ${AWB_A}, 'manual_admin'),
          (${TASK_A_NO_AWB}, ${TENANT_A}, ${CONSIGNEE_A}, ${`AFP-ORD-${RUN_ID}-A2`},
           '2026-05-15', '10:00', '12:00', 'CREATED', NULL, 'manual_admin'),
          (${TASK_B}, ${TENANT_B}, ${CONSIGNEE_B}, ${`AFP-ORD-${RUN_ID}-B1`},
           '2026-05-15', '09:00', '11:00', 'CREATED', NULL, 'manual_admin')
      `);

      // Three unresolved failed_pushes rows: two under tenant A, one
      // under tenant B for cross-tenant scope assertion. The ON DELETE
      // CASCADE FK + BEFORE-INSERT trigger guarantee these are valid.
      FP_A_WITH_AWB = randomUUID();
      FP_A_NO_AWB = randomUUID();
      FP_B = randomUUID();
      await tx.execute(sqlTag`
        INSERT INTO failed_pushes
          (id, tenant_id, task_id, attempt_count, task_payload,
           failure_reason, last_attempted_at)
        VALUES
          (${FP_A_WITH_AWB}, ${TENANT_A}, ${TASK_A_WITH_AWB}, 1,
           ${sqlTag`'{"customerOrderNumber":"AFP-A1"}'::jsonb`},
           'network', '2026-05-15 12:00:00+00'),
          (${FP_A_NO_AWB}, ${TENANT_A}, ${TASK_A_NO_AWB}, 2,
           ${sqlTag`'{"customerOrderNumber":"AFP-A2"}'::jsonb`},
           'server_5xx', '2026-05-15 11:00:00+00'),
          (${FP_B}, ${TENANT_B}, ${TASK_B}, 1,
           ${sqlTag`'{"customerOrderNumber":"AFP-B1"}'::jsonb`},
           'timeout', '2026-05-15 10:00:00+00')
      `);
    });
  });

  // No afterAll — random per-run UUIDs avoid collisions; audit_events_no_delete
  // RULE blocks tenant DELETE cascade.

  it("returns all tenant-A unresolved rows when no searchTerm is set", async () => {
    const rows = await withTenant(TENANT_A as Uuid, async (tx) => {
      return listUnresolvedByTenant(tx, TENANT_A as Uuid);
    });
    expect(rows.find((r) => r.id === FP_A_WITH_AWB)).toBeDefined();
    expect(rows.find((r) => r.id === FP_A_NO_AWB)).toBeDefined();
    // Cross-tenant assertion — tenant B's row never surfaces under withTenant(A).
    expect(rows.find((r) => r.id === FP_B)).toBeUndefined();
  });

  it("ILIKEs AWB against the parent task's external_tracking_number", async () => {
    const rows = await withTenant(TENANT_A as Uuid, async (tx) => {
      return listUnresolvedByTenant(tx, TENANT_A as Uuid, { searchTerm: AWB_A });
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(FP_A_WITH_AWB);
    expect(rows[0].taskId).toBe(TASK_A_WITH_AWB);
  });

  it("ILIKEs partial UUID match against fp.task_id::text", async () => {
    // First 8 chars of the UUID — enough to disambiguate within the
    // seeded tenant but tests the ::text cast operates correctly.
    const prefix = TASK_A_NO_AWB.slice(0, 8);
    const rows = await withTenant(TENANT_A as Uuid, async (tx) => {
      return listUnresolvedByTenant(tx, TENANT_A as Uuid, { searchTerm: prefix });
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(FP_A_NO_AWB);
    expect(rows[0].taskId).toBe(TASK_A_NO_AWB);
  });

  it("returns empty for a string that matches nothing", async () => {
    const rows = await withTenant(TENANT_A as Uuid, async (tx) => {
      return listUnresolvedByTenant(tx, TENANT_A as Uuid, {
        searchTerm: `afp-no-match-${RUN_ID}-zzz`,
      });
    });
    expect(rows.find((r) => [FP_A_WITH_AWB, FP_A_NO_AWB, FP_B].includes(r.id))).toBeUndefined();
  });

  it("single-tenant scoping enforced — tenant B's row never surfaces under withTenant(A) even on full-match search", async () => {
    const rows = await withTenant(TENANT_A as Uuid, async (tx) => {
      // Search by tenant-B's task id prefix — would match if scoping leaked.
      return listUnresolvedByTenant(tx, TENANT_A as Uuid, {
        searchTerm: TASK_B.slice(0, 8),
      });
    });
    expect(rows.find((r) => r.id === FP_B)).toBeUndefined();
  });
});
