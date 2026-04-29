// tests/integration/task-packages-tenant-match.spec.ts
// =============================================================================
// T-1 — schema-layer invariant test for the task_packages_tenant_match
// trigger.
//
// What this test proves:
//   The BEFORE INSERT OR UPDATE trigger added in 0007_task_package.sql
//   asserts task_packages.tenant_id equals the parent tasks.tenant_id and
//   raises an exception otherwise. The trigger MUST fire even under
//   BYPASSRLS callers — that is the leak vector it is designed to close.
//
// Why this lives in its own file:
//   rls-tenant-isolation.spec.ts is the regression suite for the RLS
//   policy form (predicate behaviour under withTenant / withServiceRole /
//   no-session-var canary). The trigger this test exercises is a
//   different mechanism — a row-level integrity check that runs
//   regardless of the policy state. Keeping it in a separate file keeps
//   each suite focused on one mechanism.
//
// Why this connects directly via `postgres-js` rather than withServiceRole:
//   Same reasoning as the canary block in rls-tenant-isolation.spec.ts —
//   the point is to demonstrate that bypassing the wrapper does not
//   bypass the protection. The trigger fires regardless of whether the
//   caller is `withServiceRole`, raw `postgres` superuser, or anything
//   else, because triggers run independently of RLS policy state.
//
// Determinism:
//   Random per-run UUIDs (same reasoning as rls-tenant-isolation.spec.ts:
//   audit_events_no_delete + ON DELETE CASCADE interaction makes the
//   obvious cleanup path inert, and concurrent runs on a shared local DB
//   would otherwise trample each other).
// =============================================================================

import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("T-1 — task_packages_tenant_match trigger fires under BYPASSRLS", () => {
  const RUN_ID = randomUUID().slice(0, 8);
  const TENANT_A = randomUUID();
  const TENANT_B = randomUUID();
  const SLUG_A = `t1-trigger-${RUN_ID}-a`;
  const SLUG_B = `t1-trigger-${RUN_ID}-b`;
  const CONSIGNEE_PHONE = `t1-trigger-${RUN_ID}-1`;

  let sql: ReturnType<typeof postgres>;
  let consigneeId: string;
  let taskId: string;

  beforeAll(async () => {
    const url = process.env.SUPABASE_DATABASE_URL;
    if (!url) {
      throw new Error(
        "SUPABASE_DATABASE_URL must be set for the T-1 trigger test — this connection is the superuser/BYPASSRLS path the trigger is designed to guard against",
      );
    }
    sql = postgres(url, { prepare: false, max: 1 });

    // Sanity-check this really is the BYPASSRLS connection. If it isn't,
    // the test is meaningless because the rejection could come from RLS
    // rather than the trigger. Surface the misconfiguration loudly.
    const role = await sql<{ role: string; bypassrls: boolean }[]>`
      SELECT current_user AS role, rolbypassrls AS bypassrls
      FROM pg_roles
      WHERE rolname = current_user
    `;
    expect(role[0].bypassrls).toBe(true);

    // Seed: two tenants, one consignee in TENANT_A, one task in TENANT_A.
    // All inserts run as the BYPASSRLS connection so RLS can't interfere
    // with the seed.
    await sql`
      INSERT INTO tenants (id, slug, name) VALUES
        (${TENANT_A}, ${SLUG_A}, 'T-1 Trigger Test Tenant A'),
        (${TENANT_B}, ${SLUG_B}, 'T-1 Trigger Test Tenant B')
    `;
    const consigneeRows = await sql<{ id: string }[]>`
      INSERT INTO consignees (
        tenant_id, name, phone, address_line, emirate_or_region
      ) VALUES (
        ${TENANT_A}, 'T-1 Trigger Consignee', ${CONSIGNEE_PHONE}, 'Test Address', 'Dubai'
      )
      RETURNING id
    `;
    consigneeId = consigneeRows[0].id;

    const taskRows = await sql<{ id: string }[]>`
      INSERT INTO tasks (
        tenant_id, consignee_id, customer_order_number,
        delivery_date, delivery_start_time, delivery_end_time
      ) VALUES (
        ${TENANT_A}, ${consigneeId}, ${`T1-TRIGGER-${RUN_ID}`},
        '2026-05-01', '14:00', '16:00'
      )
      RETURNING id
    `;
    taskId = taskRows[0].id;
  });

  afterAll(async () => {
    // Best-effort cleanup. ON DELETE CASCADE from tenants reaps
    // consignees, tasks, and task_packages in one shot. Wrapped in a
    // try/catch because this runs even if beforeAll failed partway and
    // the rows may not exist.
    try {
      await sql`DELETE FROM tenants WHERE id IN (${TENANT_A}, ${TENANT_B})`;
    } catch {
      // Cleanup failure is not test failure.
    }
    await sql.end({ timeout: 2 });
  });

  it("inserting a task_packages row with a mismatched tenant_id raises a P0001 exception", async () => {
    // Direct INSERT through the BYPASSRLS connection. RLS policies don't
    // fire here. The ONLY thing standing between this insert and a
    // tenant-id-mismatch row landing in the table is the trigger.
    let raised: unknown = null;
    try {
      await sql`
        INSERT INTO task_packages (
          task_id, tenant_id, position
        ) VALUES (
          ${taskId}, ${TENANT_B}, 0
        )
      `;
    } catch (err) {
      raised = err;
    }

    expect(raised).not.toBeNull();
    // postgres-js wraps DB errors with `code` (SQLSTATE) and `message`.
    // RAISE EXCEPTION yields SQLSTATE P0001 (raise_exception). The
    // message should reference our custom assertion text.
    const error = raised as { code?: string; message?: string };
    expect(error.code).toBe("P0001");
    expect(error.message).toContain("does not match parent task tenant_id");
  });

  it("no task_packages row was actually inserted (the rejected INSERT did not partially succeed)", async () => {
    const rows = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM task_packages WHERE task_id = ${taskId}
    `;
    expect(rows[0].n).toBe(0);
  });

  it("a matching tenant_id INSERT succeeds (proves the trigger isn't over-rejecting)", async () => {
    // Sanity case: same setup but with the correct tenant_id. The
    // trigger should pass and the row should appear.
    await sql`
      INSERT INTO task_packages (
        task_id, tenant_id, position
      ) VALUES (
        ${taskId}, ${TENANT_A}, 0
      )
    `;

    const rows = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM task_packages WHERE task_id = ${taskId}
    `;
    expect(rows[0].n).toBe(1);
  });

  it("UPDATING a task_packages row to a mismatched tenant_id also raises", async () => {
    // The trigger fires on BEFORE INSERT OR UPDATE. The previous test
    // inserted a valid row. Try to flip its tenant_id to TENANT_B and
    // assert the trigger blocks the update too.
    let raised: unknown = null;
    try {
      await sql`
        UPDATE task_packages SET tenant_id = ${TENANT_B} WHERE task_id = ${taskId}
      `;
    } catch (err) {
      raised = err;
    }

    expect(raised).not.toBeNull();
    const error = raised as { code?: string; message?: string };
    expect(error.code).toBe("P0001");
    expect(error.message).toContain("does not match parent task tenant_id");

    // The row's tenant_id should still be TENANT_A.
    const rows = await sql<{ tenant_id: string }[]>`
      SELECT tenant_id FROM task_packages WHERE task_id = ${taskId}
    `;
    expect(rows.length).toBe(1);
    expect(rows[0].tenant_id).toBe(TENANT_A);
  });
});
