// tests/integration/migration-0026-tasks-outbound-sync-state.spec.ts
// =============================================================================
// Day-29 §D(2) Phase-1 — Migrations 0025 + 0026 schema-drift smoke
// test per plan-PR #302 §8.4. Opened with the code-PR per schema-drift
// discipline (Day-25 / Day-27 precedent: catch drift at PR time, not
// after merge).
//
// Asserts:
//   - 0025 — outbound_push_failures.operation CHECK admits 'reschedule'
//     (in addition to the existing 'update' / 'cancel' / 'bulk_cancel')
//   - 0026 — tasks.outbound_sync_state column exists with the expected
//     type, NOT NULL, and CHECK admits the original 4-value enum (the
//     post-0028 DEFAULT + 'pending'-extension assertions live in
//     tests/integration/migration-0028-tasks-outbound-sync-state-pending-default.spec.ts)
//   - 0026 — partial index tasks_outbound_sync_state_pending_idx exists
//     with the WHERE predicate restricting to non-'synced' rows
//   - 0026 — original backfill UPDATE moved 'SKIPPED + pushed_to_external_at IS
//     NOT NULL' rows out of 'synced'. Note: the 0028 backfill (Plan #317 §8 R-3
//     CASE) reclassifies rows by external_id / failed_pushes presence, so a
//     SKIPPED+pushed row with external_id NOT NULL is now 'synced' post-0028
//     — the 0026 backfill assertion has been moved to the 0028 spec which
//     asserts the post-CASE-backfill classification.
// =============================================================================

import { sql as sqlTag } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { withServiceRole } from "../../src/shared/db";

describe("Day-29 §D(2) Phase-1 — Migrations 0025 + 0026 schema-drift", () => {
  // --- 0025 — operation enum extension ---

  it("0025: outbound_push_failures.operation CHECK admits 'reschedule'", async () => {
    // Read the live CHECK constraint expression from
    // information_schema.check_constraints. The expected substring
    // includes 'reschedule' alongside the original three values.
    interface CheckRow {
      readonly check_clause: string;
    }
    const rows = (await withServiceRole(
      "0025 operation check verify",
      async (tx) =>
        tx.execute(sqlTag`
          SELECT cc.check_clause
          FROM information_schema.check_constraints cc
          JOIN information_schema.constraint_column_usage ccu
            ON cc.constraint_name = ccu.constraint_name
            AND cc.constraint_schema = ccu.constraint_schema
          WHERE ccu.table_schema = 'public'
            AND ccu.table_name = 'outbound_push_failures'
            AND ccu.column_name = 'operation'
        `),
    )) as unknown as readonly CheckRow[];

    expect(rows.length).toBeGreaterThanOrEqual(1);
    const allClauses = rows.map((r) => r.check_clause).join(" | ");
    // Postgres normalises the IN-list — assert membership rather than
    // exact text equality, which would be brittle to formatting drift.
    expect(allClauses).toMatch(/'update'/);
    expect(allClauses).toMatch(/'cancel'/);
    expect(allClauses).toMatch(/'bulk_cancel'/);
    expect(allClauses).toMatch(/'reschedule'/);
  });

  // --- 0026 — tasks.outbound_sync_state column ---

  it("0026: tasks.outbound_sync_state column exists with text type, NOT NULL", async () => {
    interface ColumnRow {
      readonly column_name: string;
      readonly data_type: string;
      readonly is_nullable: string;
      readonly column_default: string | null;
    }
    const rows = (await withServiceRole(
      "0026 column verify",
      async (tx) =>
        tx.execute(sqlTag`
          SELECT column_name, data_type, is_nullable, column_default
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'tasks'
            AND column_name = 'outbound_sync_state'
        `),
    )) as unknown as readonly ColumnRow[];

    expect(rows.length).toBe(1);
    expect(rows[0].data_type).toBe("text");
    expect(rows[0].is_nullable).toBe("NO");
    // DEFAULT post-0028 is 'pending'; the specific value assertion
    // lives in migration-0028-...spec.ts.
  });

  it("0026: tasks.outbound_sync_state CHECK admits the original 4-value enum (post-0028 also admits 'pending' — see 0028 spec)", async () => {
    interface CheckRow {
      readonly check_clause: string;
    }
    const rows = (await withServiceRole(
      "0026 enum check verify",
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
    expect(allClauses).toMatch(/'synced'/);
    expect(allClauses).toMatch(/'pending_cancel'/);
    expect(allClauses).toMatch(/'pending_reschedule'/);
    expect(allClauses).toMatch(/'failed'/);
  });

  it("0026: partial index tasks_outbound_sync_state_pending_idx exists with non-synced predicate", async () => {
    interface IndexRow {
      readonly indexdef: string;
    }
    const rows = (await withServiceRole(
      "0026 partial index verify",
      async (tx) =>
        tx.execute(sqlTag`
          SELECT indexdef
          FROM pg_indexes
          WHERE schemaname = 'public'
            AND tablename = 'tasks'
            AND indexname = 'tasks_outbound_sync_state_pending_idx'
        `),
    )) as unknown as readonly IndexRow[];

    expect(rows.length).toBe(1);
    // Index definition should mention the WHERE predicate; pg_indexes
    // normalises but preserves the column name + the not-synced filter.
    expect(rows[0].indexdef).toMatch(/outbound_sync_state/);
    expect(rows[0].indexdef).toMatch(/WHERE/i);
    expect(rows[0].indexdef).toMatch(/synced/);
  });

  // Note: the original 0026 backfill assertion (SKIPPED+pushed rows
  // moved out of 'synced') is invalidated by the 0028 backfill which
  // reclassifies by external_id NOT NULL → 'synced'. The post-0028
  // backfill semantics are asserted in
  // tests/integration/migration-0028-tasks-outbound-sync-state-pending-default.spec.ts.
});
