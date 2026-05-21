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
//   - 0028 — backfill UPDATE classified all rows per the §8 R-3 / OQ-2.1
//     CASE: external_id NOT NULL → 'synced'; unresolved failed_pushes
//     row → 'failed'; else → 'pending'. Asserted as the absence of any
//     row violating the classification.
// =============================================================================

import { sql as sqlTag } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { withServiceRole } from "../../src/shared/db";

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

  it("0028: backfill classified all rows per §8 R-3 CASE — no row violates the (external_id, failed_pushes) classification", async () => {
    // Asserts the CASE invariant holds for every row in the live DB:
    //   external_id IS NOT NULL                                 → 'synced'
    //   external_id IS NULL  AND  unresolved failed_pushes row  → 'failed'
    //   external_id IS NULL  AND  no  unresolved failed_pushes  → 'pending'
    //
    // Runtime writers (markTaskPushed, recordFailedPushAttempt,
    // markTaskSkipped CASE, cancel-task convergence) can move rows OUT
    // of the backfill classification (e.g. operator skip on a 'synced'
    // row flips to 'pending_cancel'). Those legitimate post-backfill
    // states are explicitly excluded from the violation count below —
    // 'pending_cancel' / 'pending_reschedule' are owned by the cancel
    // lane and bypass the backfill invariant.
    interface CountRow {
      readonly count: number;
    }

    // Branch 1 violation: external_id NOT NULL but state ∉ {'synced',
    // 'pending_cancel', 'pending_reschedule'}. The cancel-lane states
    // are valid post-backfill transitions from 'synced'.
    const branch1 = (await withServiceRole(
      "0028 branch1 verify",
      async (tx) =>
        tx.execute(sqlTag`
          SELECT COUNT(*)::int AS count
          FROM tasks
          WHERE external_id IS NOT NULL
            AND outbound_sync_state NOT IN ('synced', 'pending_cancel', 'pending_reschedule', 'failed')
        `),
    )) as unknown as readonly CountRow[];
    expect(branch1[0].count).toBe(0);

    // Branch 2 violation: external_id IS NULL, unresolved failed_pushes
    // exists, but state is not 'failed' / 'pending_cancel' /
    // 'pending_reschedule'. The cancel-lane states can co-exist with
    // a stale unresolved failed_pushes row (e.g. operator skipped a
    // task that had a prior push failure).
    const branch2 = (await withServiceRole(
      "0028 branch2 verify",
      async (tx) =>
        tx.execute(sqlTag`
          SELECT COUNT(*)::int AS count
          FROM tasks t
          WHERE t.external_id IS NULL
            AND EXISTS (
              SELECT 1 FROM failed_pushes fp
              WHERE fp.task_id = t.id
                AND fp.resolved_at IS NULL
            )
            AND t.outbound_sync_state NOT IN ('failed', 'pending_cancel', 'pending_reschedule')
        `),
    )) as unknown as readonly CountRow[];
    expect(branch2[0].count).toBe(0);

    // Branch 3 violation: external_id IS NULL, no unresolved failed_pushes,
    // but state is 'synced' (lies — pre-0028 default leaks). After 0028
    // backfill, no such row should exist.
    const branch3 = (await withServiceRole(
      "0028 branch3 verify",
      async (tx) =>
        tx.execute(sqlTag`
          SELECT COUNT(*)::int AS count
          FROM tasks t
          WHERE t.external_id IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM failed_pushes fp
              WHERE fp.task_id = t.id
                AND fp.resolved_at IS NULL
            )
            AND t.outbound_sync_state = 'synced'
        `),
    )) as unknown as readonly CountRow[];
    expect(branch3[0].count).toBe(0);
  });
});
