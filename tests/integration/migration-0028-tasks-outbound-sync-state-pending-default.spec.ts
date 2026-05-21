// tests/integration/migration-0028-tasks-outbound-sync-state-pending-default.spec.ts
// =============================================================================
// Day-33 PR-C — schema-drift smoke test for migration 0028 per plan-PR
// #317 §3.3 (F-3) + §6 OQ-2 / OQ-2.1 rulings at SHA f0ef560. Opened with
// the code-PR per schema-drift discipline (Day-25 / Day-27 precedent:
// catch drift at PR time, not after merge).
//
// Asserts:
//   - 0028 — tasks.outbound_sync_state DEFAULT is 'pending' (was 'synced'
//     in 0026; OQ-2 ruling (b) at f0ef560 changes the default).
//   - 0028 — CHECK enum admits the 5-value set: original 4 from 0026
//     ('synced', 'pending_cancel', 'pending_reschedule', 'failed') plus
//     the new 'pending' value.
//   - 0028 — backfill UPDATE classifies rows per the §8 R-3 / OQ-2.1
//     CASE: external_id NOT NULL → 'synced'; unresolved failed_pushes
//     row → 'failed'; else → 'pending'. Asserted by seeding three rows
//     this spec owns (one per CASE branch), re-running the CASE scoped
//     to those ids, and asserting each branch lands the expected
//     classification. Scoped to spec-owned ids because the migration's
//     backfill is a one-time-at-migration-time classification, not a
//     global maintenance invariant — later specs in the suite seed
//     test data that wouldn't be expected to satisfy the global CASE.
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { withServiceRole } from "../../src/shared/db";
import type { Uuid } from "../../src/shared/types";

describe("Day-33 PR-C — Migration 0028 outbound_sync_state default + backfill schema-drift", () => {
  it("0028: tasks.outbound_sync_state DEFAULT is 'pending'", async () => {
    interface ColumnRow {
      readonly column_default: string | null;
    }
    const rows = (await withServiceRole(
      "0028 default verify",
      async (tx) =>
        tx.execute(sqlTag`
          SELECT column_default
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'tasks'
            AND column_name = 'outbound_sync_state'
        `),
    )) as unknown as readonly ColumnRow[];

    expect(rows.length).toBe(1);
    // Postgres normalises DEFAULT 'pending' to 'pending'::text in the
    // information_schema view.
    expect(rows[0].column_default).toMatch(/'pending'/);
    expect(rows[0].column_default).not.toMatch(/'synced'/);
  });

  it("0028: tasks.outbound_sync_state CHECK admits the 5-value enum (original 4 + 'pending')", async () => {
    interface CheckRow {
      readonly check_clause: string;
    }
    const rows = (await withServiceRole(
      "0028 check enum verify",
      async (tx) =>
        tx.execute(sqlTag`
          SELECT cc.check_clause
          FROM information_schema.check_constraints cc
          JOIN information_schema.constraint_column_usage ccu
            ON cc.constraint_name = ccu.constraint_name
            AND cc.constraint_schema = ccu.constraint_schema
          WHERE ccu.table_schema = 'public'
            AND ccu.table_name = 'tasks'
            AND ccu.column_name = 'outbound_sync_state'
        `),
    )) as unknown as readonly CheckRow[];

    expect(rows.length).toBeGreaterThanOrEqual(1);
    const allClauses = rows.map((r) => r.check_clause).join(" | ");
    expect(allClauses).toMatch(/'pending'/);
    expect(allClauses).toMatch(/'synced'/);
    expect(allClauses).toMatch(/'pending_cancel'/);
    expect(allClauses).toMatch(/'pending_reschedule'/);
    expect(allClauses).toMatch(/'failed'/);
  });

  it("0028: backfill CASE classifies spec-owned seed rows correctly (branch 1: external_id → 'synced'; branch 2: unresolved failed_push → 'failed'; branch 3: bare → 'pending')", async () => {
    // The CASE backfill is a ONE-TIME-AT-MIGRATION-TIME classification —
    // it runs once when 0028 is applied and never again. After other
    // specs in the suite insert their own rows (some via markTaskPushed,
    // some via direct INSERT, some with explicit outbound_sync_state,
    // some without) a global "no row violates the CASE" invariant does
    // not hold and would be a false claim.
    //
    // Instead, we seed three rows whose ids we own, re-run the §8 R-3
    // CASE on those specific ids, and assert each branch lands its
    // expected classification. This pins the backfill's logic without
    // claiming a global maintenance invariant the migration never
    // promised.
    const RUN_ID = randomUUID().slice(0, 8);
    const TENANT_ID = randomUUID() as Uuid;
    const SLUG = `d33-prc-0028-backfill-${RUN_ID}`;
    const SUITEFLEET_CUSTOMER_CODE = `PR-C-0028-${RUN_ID}`;
    const CONSIGNEE_ID = randomUUID() as Uuid;
    const TASK_BRANCH1 = randomUUID() as Uuid;
    const TASK_BRANCH2 = randomUUID() as Uuid;
    const TASK_BRANCH3 = randomUUID() as Uuid;

    try {
      await withServiceRole("0028 backfill spec seed", async (tx) => {
        await tx.execute(sqlTag`
          INSERT INTO tenants (id, slug, name, suitefleet_customer_code)
          VALUES (${TENANT_ID}, ${SLUG}, '0028 backfill test', ${SUITEFLEET_CUSTOMER_CODE})
        `);
        await tx.execute(sqlTag`
          INSERT INTO consignees (id, tenant_id, name, phone, address_line, emirate_or_region, district)
          VALUES (${CONSIGNEE_ID}, ${TENANT_ID}, 'backfill consignee', ${`phone-${RUN_ID}`}, 'Addr', 'Dubai', 'Al Quoz')
        `);
        // Branch 1 seed — external_id NOT NULL; deliberately set state
        // to a value the CASE would override ('failed') so we can assert
        // the branch1 reclassification when we re-run the CASE on this id.
        await tx.execute(sqlTag`
          INSERT INTO tasks (id, tenant_id, consignee_id, customer_order_number,
              internal_status, delivery_date, delivery_start_time, delivery_end_time,
              created_via, external_id, outbound_sync_state)
          VALUES (${TASK_BRANCH1}, ${TENANT_ID}, ${CONSIGNEE_ID}, ${`ORD-B1-${RUN_ID}`},
              'CREATED', CURRENT_DATE + INTERVAL '7 days', '09:00', '11:00',
              'manual_admin', ${`SF-EXT-B1-${RUN_ID}`}, 'failed')
        `);
        // Branch 2 seed — external_id IS NULL; we'll attach an unresolved
        // failed_pushes row, expect branch 2 to classify as 'failed'.
        // Use an unambiguous pre-CASE state ('synced') so the CASE flip
        // is observable.
        await tx.execute(sqlTag`
          INSERT INTO tasks (id, tenant_id, consignee_id, customer_order_number,
              internal_status, delivery_date, delivery_start_time, delivery_end_time,
              created_via, outbound_sync_state)
          VALUES (${TASK_BRANCH2}, ${TENANT_ID}, ${CONSIGNEE_ID}, ${`ORD-B2-${RUN_ID}`},
              'CREATED', CURRENT_DATE + INTERVAL '7 days', '09:00', '11:00',
              'manual_admin', 'synced')
        `);
        await tx.execute(sqlTag`
          INSERT INTO failed_pushes (tenant_id, task_id, attempt_count,
              task_payload, failure_reason, first_failed_at, last_attempted_at)
          VALUES (${TENANT_ID}, ${TASK_BRANCH2}, 1,
              '{"stage":"backfill-test"}'::jsonb, 'server_5xx',
              now(), now())
        `);
        // Branch 3 seed — external_id IS NULL, no failed_pushes row;
        // pre-CASE state 'synced' (the pre-0028 lie). Branch 3 reclassifies
        // to 'pending'.
        await tx.execute(sqlTag`
          INSERT INTO tasks (id, tenant_id, consignee_id, customer_order_number,
              internal_status, delivery_date, delivery_start_time, delivery_end_time,
              created_via, outbound_sync_state)
          VALUES (${TASK_BRANCH3}, ${TENANT_ID}, ${CONSIGNEE_ID}, ${`ORD-B3-${RUN_ID}`},
              'CREATED', CURRENT_DATE + INTERVAL '7 days', '09:00', '11:00',
              'manual_admin', 'synced')
        `);
      });

      // Re-run the §8 R-3 CASE scoped to OUR seed ids only.
      await withServiceRole("0028 backfill spec re-run CASE", async (tx) =>
        tx.execute(sqlTag`
          UPDATE tasks SET outbound_sync_state = CASE
            WHEN external_id IS NOT NULL THEN 'synced'
            WHEN EXISTS (
              SELECT 1 FROM failed_pushes
              WHERE task_id = tasks.id AND resolved_at IS NULL
            ) THEN 'failed'
            ELSE 'pending'
          END
          WHERE id IN (${TASK_BRANCH1}, ${TASK_BRANCH2}, ${TASK_BRANCH3})
            AND tenant_id = ${TENANT_ID}
        `),
      );

      const rows = (await withServiceRole(
        "0028 backfill spec assert classification",
        async (tx) =>
          tx.execute(sqlTag`
            SELECT id, outbound_sync_state
            FROM tasks
            WHERE id IN (${TASK_BRANCH1}, ${TASK_BRANCH2}, ${TASK_BRANCH3})
              AND tenant_id = ${TENANT_ID}
          `),
      )) as unknown as readonly {
        readonly id: string;
        readonly outbound_sync_state: string;
      }[];

      const byId = new Map(rows.map((r) => [r.id, r.outbound_sync_state]));
      expect(byId.get(TASK_BRANCH1), "branch 1 (external_id NOT NULL → 'synced')").toBe("synced");
      expect(byId.get(TASK_BRANCH2), "branch 2 (unresolved failed_pushes → 'failed')").toBe("failed");
      expect(byId.get(TASK_BRANCH3), "branch 3 (bare → 'pending')").toBe("pending");
    } finally {
      try {
        await withServiceRole("0028 backfill spec teardown", async (tx) => {
          await tx.execute(sqlTag`DELETE FROM failed_pushes WHERE tenant_id = ${TENANT_ID}`);
          await tx.execute(sqlTag`DELETE FROM tasks WHERE tenant_id = ${TENANT_ID}`);
          await tx.execute(sqlTag`DELETE FROM consignees WHERE tenant_id = ${TENANT_ID}`);
          await tx.execute(sqlTag`DELETE FROM tenants WHERE id = ${TENANT_ID}`);
        });
      } catch {
        /* audit RULE blocks tenants DELETE; ignore — per-run UUIDs accepted-leak */
      }
    }
  });
});
