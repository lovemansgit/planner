// tests/integration/asset-scan-log.spec.ts
// =============================================================================
// Day-54 P1 — schema-layer invariants for the bag-tracking migrations
// (0032 asset_scan_log, 0033 SORTED state, 0034 tenants dark switch).
//
// What this file pins:
//   1. asset_scan_log is APPEND-ONLY: UPDATE raises P0001 always;
//      DELETE raises P0001 unless the session consciously sets the
//      teardown GUC (app.allow_scan_log_delete = 'on'). Trigger-based,
//      NOT 0002-style rules — fires under BYPASSRLS too.
//   2. tenants.task_asset_tracking_enabled DEFAULTS FALSE — Love's
//      staged-verification ruling 7b pinned by test: every tenant is
//      dark until Love flips it per tenant by sentence.
//   3. The vendor-confirmed 5-state enum: asset_tracking_cache accepts
//      SORTED post-0033; asset_scan_log accepts exactly the five and
//      rejects strangers.
//
// Connects via raw postgres-js superuser exactly like
// asset-tracking-tenant-match.spec.ts — proving the invariants hold
// under BYPASSRLS is the point.
// =============================================================================

import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("Day-54 P1 — asset_scan_log append-only + dark switch + 5-state enum", () => {
  const RUN_ID = randomUUID().slice(0, 8);
  const TENANT_A = randomUUID();
  const SLUG_A = `p1-scanlog-${RUN_ID}-a`;

  let sql: ReturnType<typeof postgres>;
  let taskId: string;
  let scanLogId: string;

  beforeAll(async () => {
    const url = process.env.SUPABASE_DATABASE_URL;
    if (!url) {
      throw new Error("SUPABASE_DATABASE_URL must be set for the scan-log invariant test");
    }
    sql = postgres(url, { prepare: false, max: 1 });

    await sql`
      INSERT INTO tenants (id, slug, name) VALUES
        (${TENANT_A}, ${SLUG_A}, 'P1 Scan-Log Test Tenant')
    `;
    const consigneeRows = await sql<{ id: string }[]>`
      INSERT INTO consignees (
        tenant_id, name, phone, address_line, emirate_or_region, district
      ) VALUES (
        ${TENANT_A}, 'P1 Scan-Log Consignee', ${`p1-scanlog-${RUN_ID}`}, 'Test Address', 'Dubai', 'Test District'
      )
      RETURNING id
    `;
    const taskRows = await sql<{ id: string }[]>`
      INSERT INTO tasks (
        tenant_id, consignee_id, customer_order_number,
        delivery_date, delivery_start_time, delivery_end_time,
        created_via, external_tracking_number
      ) VALUES (
        ${TENANT_A}, ${consigneeRows[0].id}, ${`P1-SCANLOG-${RUN_ID}`},
        '2026-06-12', '14:00', '16:00',
        'manual_admin', ${`MPL-${RUN_ID}`}
      )
      RETURNING id
    `;
    taskId = taskRows[0].id;
  });

  afterAll(async () => {
    try {
      // Teardown order matters: scan-log rows RESTRICT the tenant
      // delete and the append-only trigger blocks DELETE without the
      // GUC — this is the sanctioned teardown sequence
      // (scripts/teardown-merchant.mjs mirrors it).
      await sql`SET app.allow_scan_log_delete = 'on'`;
      await sql`DELETE FROM asset_scan_log WHERE tenant_id = ${TENANT_A}`;
      await sql`RESET app.allow_scan_log_delete`;
      await sql`DELETE FROM tenants WHERE id = ${TENANT_A}`;
    } catch {
      // Cleanup failure is not test failure.
    }
    await sql.end({ timeout: 2 });
  });

  it("tenants.task_asset_tracking_enabled DEFAULTS FALSE (Love's dark switch, posture 7b)", async () => {
    const rows = await sql<{ enabled: boolean; asset_type: string | null }[]>`
      SELECT task_asset_tracking_enabled AS enabled, default_task_asset_type AS asset_type
      FROM tenants WHERE id = ${TENANT_A}
    `;
    expect(rows[0].enabled).toBe(false);
    expect(rows[0].asset_type).toBeNull();
  });

  it("accepts a well-formed scan-log INSERT (vendor_scanned_at NULL + received_at observed time)", async () => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO asset_scan_log (
        tenant_id, task_id, tracking_id, awb, state,
        vendor_scanned_at, received_at, scanned_by, source, sf_payload
      ) VALUES (
        ${TENANT_A}, ${taskId}, ${`MPL-${RUN_ID}-1`}, ${`MPL-${RUN_ID}`}, 'COLLECTED',
        NULL, now(), ${sql.json({ name: "Courier A" })}, 'poll', ${sql.json({ probe: true })}
      )
      RETURNING id
    `;
    scanLogId = rows[0].id;
    expect(scanLogId).toBeTruthy();
  });

  it("UPDATE raises P0001 — history lines are never rewritten", async () => {
    let raised: { code?: string; message?: string } | null = null;
    try {
      await sql`UPDATE asset_scan_log SET state = 'RETURNED' WHERE id = ${scanLogId}`;
    } catch (err) {
      raised = err as { code?: string };
    }
    expect(raised).not.toBeNull();
    expect(raised?.code).toBe("P0001");
    expect(raised?.message).toContain("append-only");
  });

  it("DELETE raises P0001 without the teardown GUC", async () => {
    let raised: { code?: string } | null = null;
    try {
      await sql`DELETE FROM asset_scan_log WHERE id = ${scanLogId}`;
    } catch (err) {
      raised = err as { code?: string };
    }
    expect(raised).not.toBeNull();
    expect(raised?.code).toBe("P0001");
  });

  it("DELETE succeeds with app.allow_scan_log_delete = 'on' (sanctioned teardown path only)", async () => {
    await sql`SET app.allow_scan_log_delete = 'on'`;
    const deleted = await sql`
      DELETE FROM asset_scan_log WHERE id = ${scanLogId} RETURNING id
    `;
    await sql`RESET app.allow_scan_log_delete`;
    expect(deleted).toHaveLength(1);
    // Re-insert one line so the tenant-RESTRICT test below has a row.
    await sql`
      INSERT INTO asset_scan_log (
        tenant_id, task_id, tracking_id, awb, state, received_at, source
      ) VALUES (
        ${TENANT_A}, ${taskId}, ${`MPL-${RUN_ID}-1`}, ${`MPL-${RUN_ID}`}, 'SORTED', now(), 'poll'
      )
    `;
  });

  it("scan history RESTRICTs tenant deletion — teardown must consciously clear the log first", async () => {
    let raised: { code?: string } | null = null;
    try {
      await sql`DELETE FROM tenants WHERE id = ${TENANT_A}`;
    } catch (err) {
      raised = err as { code?: string };
    }
    expect(raised).not.toBeNull();
    // 23503 foreign_key_violation (RESTRICT) or P0001 from the trigger,
    // depending on which fires first — either way the tenant survives.
    const tenants = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM tenants WHERE id = ${TENANT_A}
    `;
    expect(tenants[0].n).toBe(1);
  });

  it("asset_scan_log accepts SORTED and rejects states outside the confirmed five", async () => {
    let raised: { code?: string } | null = null;
    try {
      await sql`
        INSERT INTO asset_scan_log (
          tenant_id, task_id, tracking_id, awb, state, received_at, source
        ) VALUES (
          ${TENANT_A}, ${taskId}, ${`MPL-${RUN_ID}-2`}, ${`MPL-${RUN_ID}`}, 'TELEPORTED', now(), 'poll'
        )
      `;
    } catch (err) {
      raised = err as { code?: string };
    }
    expect(raised?.code).toBe("23514"); // check_violation
  });

  it("asset_tracking_cache accepts SORTED post-0033 (the report's missing column state)", async () => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO asset_tracking_cache (
        task_id, task_id_external, external_record_id,
        tracking_id, type, state, tenant_id
      ) VALUES (
        ${taskId}, 99001, 70001,
        ${`MPL-${RUN_ID}-1`}, 'BAGS', 'SORTED', ${TENANT_A}
      )
      RETURNING id
    `;
    expect(rows).toHaveLength(1);
  });
});
