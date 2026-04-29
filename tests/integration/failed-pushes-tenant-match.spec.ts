// tests/integration/failed-pushes-tenant-match.spec.ts
// =============================================================================
// T-6 — schema-layer invariant test for the
// failed_pushes_assert_tenant_match trigger.
//
// Mirrors the task_packages-tenant-match.spec.ts pattern from T-1.
// What this test proves:
//   The BEFORE INSERT OR UPDATE trigger added in 0008_failed_pushes.sql
//   asserts failed_pushes.tenant_id equals the parent tasks.tenant_id
//   and raises an exception otherwise. The trigger MUST fire even
//   under BYPASSRLS callers — that is the leak vector it is designed
//   to close.
//
// Why this lives in its own file:
//   rls-tenant-isolation.spec.ts is the regression suite for the RLS
//   policy form. The trigger this test exercises is a different
//   mechanism — a row-level integrity check that runs regardless of
//   policy state. Same separation as task-packages-tenant-match.spec.ts.
//
// Why this connects directly via `postgres-js` rather than withServiceRole:
//   Same reasoning as the canary block in rls-tenant-isolation.spec.ts —
//   the point is to demonstrate that bypassing the wrapper does not
//   bypass the protection. The trigger fires regardless of the caller.
//
// Determinism:
//   Random per-run UUIDs (same reasoning as T-1's trigger spec).
// =============================================================================

import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("T-6 — failed_pushes_assert_tenant_match trigger fires under BYPASSRLS", () => {
  const RUN_ID = randomUUID().slice(0, 8);
  const TENANT_A = randomUUID();
  const TENANT_B = randomUUID();
  const SLUG_A = `t6-trigger-${RUN_ID}-a`;
  const SLUG_B = `t6-trigger-${RUN_ID}-b`;
  const CONSIGNEE_PHONE = `t6-trigger-${RUN_ID}-1`;

  let sql: ReturnType<typeof postgres>;
  let consigneeId: string;
  let taskId: string;

  beforeAll(async () => {
    const url = process.env.SUPABASE_DATABASE_URL;
    if (!url) {
      throw new Error(
        "SUPABASE_DATABASE_URL must be set for the T-6 trigger test — this connection is the superuser/BYPASSRLS path the trigger is designed to guard against",
      );
    }
    sql = postgres(url, { prepare: false, max: 1 });

    // Sanity-check this really is the BYPASSRLS connection. If it
    // isn't, the test is meaningless because the rejection could
    // come from RLS rather than the trigger.
    const role = await sql<{ role: string; bypassrls: boolean }[]>`
      SELECT current_user AS role, rolbypassrls AS bypassrls
      FROM pg_roles
      WHERE rolname = current_user
    `;
    expect(role[0].bypassrls).toBe(true);

    // Seed: two tenants, one consignee in TENANT_A, one task in
    // TENANT_A. All inserts run as the BYPASSRLS connection so RLS
    // can't interfere with the seed.
    await sql`
      INSERT INTO tenants (id, slug, name) VALUES
        (${TENANT_A}, ${SLUG_A}, 'T-6 Trigger Test Tenant A'),
        (${TENANT_B}, ${SLUG_B}, 'T-6 Trigger Test Tenant B')
    `;
    const consigneeRows = await sql<{ id: string }[]>`
      INSERT INTO consignees (
        tenant_id, name, phone, address_line, emirate_or_region
      ) VALUES (
        ${TENANT_A}, 'T-6 Trigger Consignee', ${CONSIGNEE_PHONE}, 'Test Address', 'Dubai'
      )
      RETURNING id
    `;
    consigneeId = consigneeRows[0].id;

    const taskRows = await sql<{ id: string }[]>`
      INSERT INTO tasks (
        tenant_id, consignee_id, customer_order_number,
        delivery_date, delivery_start_time, delivery_end_time
      ) VALUES (
        ${TENANT_A}, ${consigneeId}, ${`T6-TRIGGER-${RUN_ID}`},
        '2026-05-01', '14:00', '16:00'
      )
      RETURNING id
    `;
    taskId = taskRows[0].id;
  });

  afterAll(async () => {
    try {
      await sql`DELETE FROM tenants WHERE id IN (${TENANT_A}, ${TENANT_B})`;
    } catch {
      // Cleanup failure is not test failure.
    }
    await sql.end({ timeout: 2 });
  });

  it("inserting a failed_pushes row with a mismatched tenant_id raises a P0001 exception", async () => {
    let raised: unknown = null;
    try {
      await sql`
        INSERT INTO failed_pushes (
          task_id, tenant_id, task_payload, failure_reason
        ) VALUES (
          ${taskId}, ${TENANT_B}, '{}'::jsonb, 'network'
        )
      `;
    } catch (err) {
      raised = err;
    }

    expect(raised).not.toBeNull();
    const error = raised as { code?: string; message?: string };
    expect(error.code).toBe("P0001");
    expect(error.message).toContain("does not match parent task tenant_id");
  });

  it("no failed_pushes row was actually inserted (the rejected INSERT did not partially succeed)", async () => {
    const rows = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM failed_pushes WHERE task_id = ${taskId}
    `;
    expect(rows[0].n).toBe(0);
  });

  it("a matching tenant_id INSERT succeeds (proves the trigger isn't over-rejecting)", async () => {
    await sql`
      INSERT INTO failed_pushes (
        task_id, tenant_id, task_payload, failure_reason
      ) VALUES (
        ${taskId}, ${TENANT_A}, '{"customerOrderNumber":"T6"}'::jsonb, 'network'
      )
    `;

    const rows = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM failed_pushes WHERE task_id = ${taskId}
    `;
    expect(rows[0].n).toBe(1);
  });

  it("UPDATING a failed_pushes row to a mismatched tenant_id also raises", async () => {
    let raised: unknown = null;
    try {
      await sql`
        UPDATE failed_pushes SET tenant_id = ${TENANT_B} WHERE task_id = ${taskId}
      `;
    } catch (err) {
      raised = err;
    }

    expect(raised).not.toBeNull();
    const error = raised as { code?: string; message?: string };
    expect(error.code).toBe("P0001");
    expect(error.message).toContain("does not match parent task tenant_id");

    const rows = await sql<{ tenant_id: string }[]>`
      SELECT tenant_id FROM failed_pushes WHERE task_id = ${taskId}
    `;
    expect(rows.length).toBe(1);
    expect(rows[0].tenant_id).toBe(TENANT_A);
  });

  it("partial UNIQUE — a second unresolved row for the same task fails the unique constraint (not the trigger)", async () => {
    // The first matching INSERT (above test) created an unresolved
    // row. A second unresolved INSERT for the same task_id must fail
    // — but on the partial UNIQUE index, not the tenant-match
    // trigger. Confirms both invariants coexist correctly.
    let raised: unknown = null;
    try {
      await sql`
        INSERT INTO failed_pushes (
          task_id, tenant_id, task_payload, failure_reason
        ) VALUES (
          ${taskId}, ${TENANT_A}, '{}'::jsonb, 'timeout'
        )
      `;
    } catch (err) {
      raised = err;
    }

    expect(raised).not.toBeNull();
    const error = raised as { code?: string; message?: string };
    // 23505 is unique_violation; distinct from P0001 (the trigger's
    // raise). Asserting the SQLSTATE confirms the rejection comes
    // from the index, not the trigger.
    expect(error.code).toBe("23505");
  });
});
