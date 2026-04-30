// tests/integration/asset-tracking-tenant-match.spec.ts
// =============================================================================
// B-1 — schema-layer invariant test for the
// asset_tracking_cache_assert_tenant_match trigger.
//
// Mirrors the task-packages-tenant-match.spec.ts (T-1) and
// failed-pushes-tenant-match.spec.ts (T-6) patterns.
//
// What this test proves:
//   The BEFORE INSERT OR UPDATE trigger added in
//   0011_asset_tracking_cache.sql asserts
//   asset_tracking_cache.tenant_id equals the parent tasks.tenant_id
//   and raises an exception otherwise. The trigger MUST fire even
//   under BYPASSRLS callers — that is the leak vector it is designed
//   to close.
//
// Why this lives in its own file:
//   rls-tenant-isolation.spec.ts is the regression suite for the RLS
//   policy form. The trigger this test exercises is a different
//   mechanism — a row-level integrity check that runs regardless of
//   policy state. Same separation as the other two tenant-match
//   spec files.
//
// Why this connects directly via `postgres-js` rather than withServiceRole:
//   The point is to demonstrate that bypassing the wrapper does not
//   bypass the protection. The trigger fires regardless of whether
//   the caller is `withServiceRole`, raw `postgres` superuser, or
//   anything else, because triggers run independently of RLS.
//
// Determinism:
//   Random per-run UUIDs (same reasoning as T-1 / T-6).
// =============================================================================

import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("B-1 — asset_tracking_cache_assert_tenant_match trigger fires under BYPASSRLS", () => {
  const RUN_ID = randomUUID().slice(0, 8);
  const TENANT_A = randomUUID();
  const TENANT_B = randomUUID();
  const SLUG_A = `b1-trigger-${RUN_ID}-a`;
  const SLUG_B = `b1-trigger-${RUN_ID}-b`;
  const CONSIGNEE_PHONE = `b1-trigger-${RUN_ID}-1`;

  let sql: ReturnType<typeof postgres>;
  let consigneeId: string;
  let taskId: string;

  beforeAll(async () => {
    const url = process.env.SUPABASE_DATABASE_URL;
    if (!url) {
      throw new Error(
        "SUPABASE_DATABASE_URL must be set for the B-1 trigger test — this connection is the superuser/BYPASSRLS path the trigger is designed to guard against",
      );
    }
    sql = postgres(url, { prepare: false, max: 1 });

    const role = await sql<{ role: string; bypassrls: boolean }[]>`
      SELECT current_user AS role, rolbypassrls AS bypassrls
      FROM pg_roles
      WHERE rolname = current_user
    `;
    expect(role[0].bypassrls).toBe(true);

    await sql`
      INSERT INTO tenants (id, slug, name) VALUES
        (${TENANT_A}, ${SLUG_A}, 'B-1 Trigger Test Tenant A'),
        (${TENANT_B}, ${SLUG_B}, 'B-1 Trigger Test Tenant B')
    `;
    const consigneeRows = await sql<{ id: string }[]>`
      INSERT INTO consignees (
        tenant_id, name, phone, address_line, emirate_or_region
      ) VALUES (
        ${TENANT_A}, 'B-1 Trigger Consignee', ${CONSIGNEE_PHONE}, 'Test Address', 'Dubai'
      )
      RETURNING id
    `;
    consigneeId = consigneeRows[0].id;

    const taskRows = await sql<{ id: string }[]>`
      INSERT INTO tasks (
        tenant_id, consignee_id, customer_order_number,
        delivery_date, delivery_start_time, delivery_end_time,
        created_via
      ) VALUES (
        ${TENANT_A}, ${consigneeId}, ${`B1-TRIGGER-${RUN_ID}`},
        '2026-05-01', '14:00', '16:00',
        'manual_admin'
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

  it("inserting an asset_tracking_cache row with a mismatched tenant_id raises a P0001 exception", async () => {
    let raised: unknown = null;
    try {
      await sql`
        INSERT INTO asset_tracking_cache (
          task_id, task_id_external, external_record_id,
          tracking_id, type, state, tenant_id
        ) VALUES (
          ${taskId}, 99001, 70001,
          ${`B1-MISMATCH-${RUN_ID}-1`},
          'BAGS', 'COLLECTED', ${TENANT_B}
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

  it("no asset_tracking_cache row was actually inserted (the rejected INSERT did not partially succeed)", async () => {
    const rows = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM asset_tracking_cache WHERE task_id = ${taskId}
    `;
    expect(rows[0].n).toBe(0);
  });

  it("a matching tenant_id INSERT succeeds (proves the trigger isn't over-rejecting)", async () => {
    await sql`
      INSERT INTO asset_tracking_cache (
        task_id, task_id_external, external_record_id,
        tracking_id, type, state, tenant_id
      ) VALUES (
        ${taskId}, 99001, 70001,
        ${`B1-OK-${RUN_ID}-1`},
        'BAGS', 'COLLECTED', ${TENANT_A}
      )
    `;

    const rows = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM asset_tracking_cache WHERE task_id = ${taskId}
    `;
    expect(rows[0].n).toBe(1);
  });

  it("UPDATING an asset_tracking_cache row to a mismatched tenant_id also raises", async () => {
    let raised: unknown = null;
    try {
      await sql`
        UPDATE asset_tracking_cache
        SET tenant_id = ${TENANT_B}
        WHERE task_id = ${taskId}
      `;
    } catch (err) {
      raised = err;
    }

    expect(raised).not.toBeNull();
    const error = raised as { code?: string; message?: string };
    expect(error.code).toBe("P0001");
    expect(error.message).toContain("does not match parent task tenant_id");

    const rows = await sql<{ tenant_id: string }[]>`
      SELECT tenant_id FROM asset_tracking_cache WHERE task_id = ${taskId}
    `;
    expect(rows.length).toBe(1);
    expect(rows[0].tenant_id).toBe(TENANT_A);
  });

  it("inserting a row whose task_id does not exist raises P0001 from the trigger (BEFORE INSERT runs ahead of FK)", async () => {
    const ghostTaskId = randomUUID();
    let raised: unknown = null;
    try {
      await sql`
        INSERT INTO asset_tracking_cache (
          task_id, task_id_external, external_record_id,
          tracking_id, type, state, tenant_id
        ) VALUES (
          ${ghostTaskId}, 99002, 70002,
          ${`B1-GHOST-${RUN_ID}-1`},
          'BAGS', 'COLLECTED', ${TENANT_A}
        )
      `;
    } catch (err) {
      raised = err;
    }

    expect(raised).not.toBeNull();
    const error = raised as { code?: string; message?: string };
    // Postgres BEFORE INSERT triggers fire ahead of FK constraint
    // checks. The trigger's `SELECT tenant_id INTO parent_tenant FROM
    // tasks WHERE id = NEW.task_id` returns NULL when the parent does
    // not exist, and the trigger raises its own "does not exist"
    // P0001 before the FK constraint (23503) gets a chance. The
    // observable result is P0001 with the trigger's message — not
    // 23503. Pin both to surface drift if Postgres ever reorders.
    expect(error.code).toBe("P0001");
    expect(error.message).toContain("does not exist");
  });
});
