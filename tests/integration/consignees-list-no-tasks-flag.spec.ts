// tests/integration/consignees-list-no-tasks-flag.spec.ts
// =============================================================================
// Day-25 / brief v1.12 §3.4 — integration spec for the NO TASKS amber
// badge computation. Targets the new `listConsigneesWithTaskCountByTenant`
// repository fn.
//
// Pins:
//   1. Consignee with zero tasks → taskCount === 0 (flag renders).
//   2. Consignee with one ad-hoc task → taskCount === 1 (flag absent).
//   3. Consignee with two tasks (mix of statuses) → taskCount === 2.
//   4. Cross-tenant pollution — tasks in another tenant's consignee do
//      NOT bleed into the count.
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { listConsigneesWithTaskCountByTenant } from "../../src/modules/consignees/repository";
import { withServiceRole } from "../../src/shared/db";

const RUN_ID = randomUUID().slice(0, 8);
const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const CONSIGNEE_ZERO = randomUUID();
const CONSIGNEE_ONE = randomUUID();
const CONSIGNEE_TWO = randomUUID();
const CONSIGNEE_OTHER_TENANT = randomUUID();

describe("Day-25 integration — listConsigneesWithTaskCount NO TASKS flag", () => {
  beforeAll(async () => {
    await withServiceRole("no-tasks-flag setup", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, status) VALUES
          (${TENANT_A}, ${`ntf-${RUN_ID}-a`}, 'NTF A', 'active'),
          (${TENANT_B}, ${`ntf-${RUN_ID}-b`}, 'NTF B', 'active')
      `);

      await tx.execute(sqlTag`
        INSERT INTO consignees
          (id, tenant_id, name, phone, address_line, emirate_or_region, district, crm_state)
        VALUES
          (${CONSIGNEE_ZERO}, ${TENANT_A}, 'Zero Tasks', ${`ntf-${RUN_ID}-z`}, 'Addr', 'Dubai', 'D', 'ACTIVE'),
          (${CONSIGNEE_ONE}, ${TENANT_A}, 'One Task', ${`ntf-${RUN_ID}-o`}, 'Addr', 'Dubai', 'D', 'ACTIVE'),
          (${CONSIGNEE_TWO}, ${TENANT_A}, 'Two Tasks', ${`ntf-${RUN_ID}-t`}, 'Addr', 'Dubai', 'D', 'ACTIVE'),
          (${CONSIGNEE_OTHER_TENANT}, ${TENANT_B}, 'Cross-Tenant', ${`ntf-${RUN_ID}-x`}, 'Addr', 'Dubai', 'D', 'ACTIVE')
      `);

      // CONSIGNEE_ONE gets exactly 1 task in tenant A.
      // CONSIGNEE_TWO gets 2 tasks in tenant A.
      // CONSIGNEE_OTHER_TENANT gets 1 task in tenant B — must NOT count
      // toward tenant A's totals.
      await tx.execute(sqlTag`
        INSERT INTO tasks
          (id, tenant_id, consignee_id, customer_order_number,
           delivery_date, delivery_start_time, delivery_end_time,
           internal_status, created_via)
        VALUES
          (${randomUUID()}, ${TENANT_A}, ${CONSIGNEE_ONE},  ${`NTF-${RUN_ID}-1`},
           '2026-06-01', '10:00', '12:00', 'CREATED', 'manual_admin'),
          (${randomUUID()}, ${TENANT_A}, ${CONSIGNEE_TWO},  ${`NTF-${RUN_ID}-2a`},
           '2026-06-01', '10:00', '12:00', 'DELIVERED', 'manual_admin'),
          (${randomUUID()}, ${TENANT_A}, ${CONSIGNEE_TWO},  ${`NTF-${RUN_ID}-2b`},
           '2026-06-02', '14:00', '16:00', 'CANCELED', 'manual_admin'),
          (${randomUUID()}, ${TENANT_B}, ${CONSIGNEE_OTHER_TENANT}, ${`NTF-${RUN_ID}-x`},
           '2026-06-01', '10:00', '12:00', 'CREATED', 'manual_admin')
      `);
    });
  });

  afterAll(async () => {
    // audit_events_no_delete RULE blocks DELETE FROM tenants when matching
    // audit_events exist (see memory/followup_audit_rule_cascade_conflict.md).
    // Best-effort teardown; swallow the rule-induced failure.
    try {
      await withServiceRole("no-tasks-flag teardown", async (tx) => {
        await tx.execute(sqlTag`DELETE FROM tenants WHERE id IN (${TENANT_A}, ${TENANT_B})`);
      });
    } catch {
      /* audit RULE; ignore */
    }
  });

  it("returns taskCount=0 for consignees with no tasks (flag renders)", async () => {
    const rows = await withServiceRole("no-tasks-flag read", async (tx) => {
      // Set the tenant session var so RLS scopes — mimics withTenant.
      await tx.execute(sqlTag`SELECT set_config('app.current_tenant_id', ${TENANT_A}, true)`);
      return listConsigneesWithTaskCountByTenant(tx, TENANT_A);
    });
    const zero = rows.find((r) => r.id === CONSIGNEE_ZERO);
    expect(zero?.taskCount).toBe(0);
  });

  it("returns the correct count for consignees with one or many tasks (any status)", async () => {
    const rows = await withServiceRole("count read", async (tx) => {
      await tx.execute(sqlTag`SELECT set_config('app.current_tenant_id', ${TENANT_A}, true)`);
      return listConsigneesWithTaskCountByTenant(tx, TENANT_A);
    });
    const one = rows.find((r) => r.id === CONSIGNEE_ONE);
    const two = rows.find((r) => r.id === CONSIGNEE_TWO);
    expect(one?.taskCount).toBe(1);
    expect(two?.taskCount).toBe(2);
  });

  it("does not surface tasks from other tenants in the count", async () => {
    const rows = await withServiceRole("cross-tenant probe", async (tx) => {
      await tx.execute(sqlTag`SELECT set_config('app.current_tenant_id', ${TENANT_A}, true)`);
      return listConsigneesWithTaskCountByTenant(tx, TENANT_A);
    });
    // tenant A query should never return tenant B's consignee row.
    expect(rows.find((r) => r.id === CONSIGNEE_OTHER_TENANT)).toBeUndefined();
  });
});
