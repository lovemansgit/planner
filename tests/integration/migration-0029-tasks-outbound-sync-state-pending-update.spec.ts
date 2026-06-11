// tests/integration/migration-0029-tasks-outbound-sync-state-pending-update.spec.ts
// =============================================================================
// Day-52 — schema-drift smoke test for migration 0029 per plan-PR #335
// §3 optional migration + §5 OQ-1 ruling (a). Opened with the migration
// PR per schema-drift discipline (Day-25 / Day-27 precedent: catch
// drift at PR time, not after merge).
//
// Asserts:
//   - 0029 — CHECK enum admits the 6-value set: the 5 values from 0028
//     ('synced', 'pending_cancel', 'pending_reschedule', 'failed',
//     'pending') plus the new 'pending_update'.
//   - 0029 — a task row accepts an UPDATE to 'pending_update' and a
//     bogus value is still rejected (constraint present, not dropped).
//   - 0029 — DEFAULT stays 'pending' (0029 touches the CHECK only; the
//     0028 default must survive the constraint swap).
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { withServiceRole } from "../../src/shared/db";
import type { Uuid } from "../../src/shared/types";

const RUN_ID = randomUUID().slice(0, 8);
const TENANT = randomUUID() as Uuid;
const CONSIGNEE = randomUUID() as Uuid;
const TASK = randomUUID() as Uuid;

describe("Day-52 — Migration 0029 outbound_sync_state 'pending_update' schema-drift", () => {
  it("0029: CHECK constraint admits the 6-value enum including 'pending_update'", async () => {
    interface CheckRow {
      readonly check_clause: string;
    }
    const rows = (await withServiceRole(
      "0029 check-clause verify",
      async (tx) =>
        tx.execute(sqlTag`
          SELECT cc.check_clause
          FROM information_schema.check_constraints cc
          WHERE cc.constraint_schema = 'public'
            AND cc.constraint_name = 'tasks_outbound_sync_state_check'
        `),
    )) as unknown as readonly CheckRow[];

    expect(rows.length).toBe(1);
    const clause = rows[0].check_clause;
    for (const value of [
      "synced",
      "pending_cancel",
      "pending_reschedule",
      "failed",
      "pending",
      "pending_update",
    ]) {
      expect(clause).toContain(`'${value}'`);
    }
  });

  it("0029: a task row accepts 'pending_update'; a bogus value is still rejected; DEFAULT stays 'pending'", async () => {
    await withServiceRole("0029 seed", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, status)
        VALUES (${TENANT}, ${`m0029-${RUN_ID}`}, 'Migration 0029 Spec Tenant', 'active')
      `);
      await tx.execute(sqlTag`
        INSERT INTO consignees (
          id, tenant_id, name, email, phone,
          address_line, emirate_or_region, district
        ) VALUES (${CONSIGNEE}, ${TENANT}, 'M0029 Consignee', 'm0029@test.example',
                  '+971500000299', 'Line', 'Dubai', 'District')
      `);
      await tx.execute(sqlTag`
        INSERT INTO tasks (
          id, tenant_id, consignee_id, created_via,
          customer_order_number, internal_status,
          delivery_date, delivery_start_time, delivery_end_time
        ) VALUES (${TASK}, ${TENANT}, ${CONSIGNEE}, 'manual_admin',
                  ${`ORD-M0029-${RUN_ID}`}, 'CREATED',
                  CURRENT_DATE + 30, '09:00:00', '18:00:00')
      `);
    });

    // DEFAULT survives the 0029 constraint swap (0028 semantics).
    const defaulted = (await withServiceRole("0029 default read", async (tx) =>
      tx.execute(sqlTag`
        SELECT outbound_sync_state FROM tasks WHERE id = ${TASK}
      `),
    )) as unknown as readonly { outbound_sync_state: string }[];
    expect(defaulted[0].outbound_sync_state).toBe("pending");

    // 'pending_update' is admitted.
    await withServiceRole("0029 pending_update write", async (tx) => {
      await tx.execute(sqlTag`
        UPDATE tasks SET outbound_sync_state = 'pending_update' WHERE id = ${TASK}
      `);
    });
    const updated = (await withServiceRole("0029 pending_update read", async (tx) =>
      tx.execute(sqlTag`
        SELECT outbound_sync_state FROM tasks WHERE id = ${TASK}
      `),
    )) as unknown as readonly { outbound_sync_state: string }[];
    expect(updated[0].outbound_sync_state).toBe("pending_update");

    // A bogus value is still rejected — the constraint was re-added, not
    // silently dropped by the swap. The drizzle wrapper masks the pg
    // constraint name in the thrown message, so assert the rejection
    // generically AND prove the write did not land.
    await expect(
      withServiceRole("0029 bogus write", async (tx) => {
        await tx.execute(sqlTag`
          UPDATE tasks SET outbound_sync_state = 'bogus_state' WHERE id = ${TASK}
        `);
      }),
    ).rejects.toThrow();
    const afterBogus = (await withServiceRole("0029 post-bogus read", async (tx) =>
      tx.execute(sqlTag`
        SELECT outbound_sync_state FROM tasks WHERE id = ${TASK}
      `),
    )) as unknown as readonly { outbound_sync_state: string }[];
    expect(afterBogus[0].outbound_sync_state).toBe("pending_update");
  });
});
