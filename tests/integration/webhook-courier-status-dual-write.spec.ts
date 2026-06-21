// tests/integration/webhook-courier-status-dual-write.spec.ts
// =============================================================================
// D56 Phase 8 / Lane 2 — applier dual-write of tasks.courier_status.
//
// Pins the real-Postgres behaviour of the webhook appliers writing BOTH the
// coarse internal_status (unchanged business spine) AND the new fine
// courier_status column in the SAME UPDATE:
//   1. Happy path — a status event writes both columns.
//   2. Coarse no-op while fine advances — PICKED_UP -> OUT_FOR_DELIVERY keeps
//      internal_status IN_TRANSIT but advances courier_status (the headline
//      reason the fine field needs its own advance guard).
//   3. Ramp regress-block — a lagging webhook cannot drop the fine column back
//      down the in-transit ramp.
//   4. Edit-event master payload — the top-level `status` field dual-writes the
//      fine column too.
//   5. SKIPPED guard — the SQL `internal_status NOT IN ('SKIPPED')` guard
//      covers the fine column as well (operator-set SKIPPED wins).
//
// MERGE-ORDER (CRITICAL): tasks.courier_status is created by Lane 1's migration
// 0035 (Session B owns it). This suite SELF-SKIPS when the column is absent so
// CI stays green while Lane 2 is reviewed in parallel; it runs for real the
// moment Lane 1's migration is applied (at merge-prep, this branch rebases onto
// a Lane-1-bearing main and CI provisions the column). Lane 2's PR must NOT
// merge before Lane 1 is on main.
//
// Per-run isolation: random RUN_ID slug suffix prevents cross-run collisions;
// teardown is implicit via random suffix per
// memory/followup_audit_rule_cascade_conflict.md (audit_events_no_delete RULE
// blocks DELETE cascade).
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { applyWebhookEditEvent } from "../../src/modules/integration/providers/suitefleet/apply-webhook-edit-event";
import { applyWebhookStatusEvent } from "../../src/modules/integration/providers/suitefleet/apply-webhook-status-event";
import type { WebhookEvent } from "../../src/modules/integration/types";
import { withServiceRole } from "../../src/shared/db";
import type { Uuid } from "../../src/shared/types";

const RUN_ID = randomUUID().slice(0, 8);
const TENANT = randomUUID() as Uuid;
const SLUG = `csd-${RUN_ID}`;
const CONSIGNEE = randomUUID();

// One task per scenario — distinct AWBs so cross-test interference is impossible.
const AWB_HAPPY = `CSD-${RUN_ID}-HAPPY`;
const AWB_FINEONLY = `CSD-${RUN_ID}-FINEONLY`;
const AWB_REGRESS = `CSD-${RUN_ID}-REGRESS`;
const AWB_MASTER = `CSD-${RUN_ID}-MASTER`;
const AWB_SKIPPED = `CSD-${RUN_ID}-SKIPPED`;

const TASK_HAPPY = randomUUID() as Uuid;
const TASK_FINEONLY = randomUUID() as Uuid;
const TASK_REGRESS = randomUUID() as Uuid;
const TASK_MASTER = randomUUID() as Uuid;
const TASK_SKIPPED = randomUUID() as Uuid;

// Numeric placeholders for tasks.external_id — production stores SF numeric IDs
// here while AWB strings live on tasks.external_tracking_number (the lookup key).
const EXT_BASE = parseInt(RUN_ID, 16);
const EXT_HAPPY = String(EXT_BASE + 1);
const EXT_FINEONLY = String(EXT_BASE + 2);
const EXT_REGRESS = String(EXT_BASE + 3);
const EXT_MASTER = String(EXT_BASE + 4);
const EXT_SKIPPED = String(EXT_BASE + 5);

let columnPresent = false;

async function hasCourierStatusColumn(): Promise<boolean> {
  const rows = await withServiceRole("check courier_status column", async (tx) =>
    tx.execute(sqlTag`
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'tasks' AND column_name = 'courier_status'
      LIMIT 1
    `),
  );
  return rows.length > 0;
}

function buildStatusEvent(awb: string, occurredAt: string, action: string): WebhookEvent {
  return {
    kind: "TASK_STATUS_CHANGED",
    externalTaskId: awb,
    occurredAt,
    idempotencyKey: `key-${awb}-${occurredAt}`,
    raw: { awb, action, eventTimestamp: occurredAt },
  };
}

function buildMasterEvent(awb: string, occurredAt: string, status: string): WebhookEvent {
  return {
    kind: "TASK_STATUS_CHANGED",
    externalTaskId: awb,
    occurredAt,
    idempotencyKey: `key-${awb}-${occurredAt}`,
    raw: { awb, action: "TASK_HAS_BEEN_UPDATED", status, eventTimestamp: occurredAt },
  };
}

async function readColumns(taskId: Uuid): Promise<{ internal_status: string; courier_status: string | null }> {
  const [row] = await withServiceRole("read status columns", async (tx) =>
    tx.execute(sqlTag`
      SELECT internal_status, courier_status FROM tasks WHERE id = ${taskId} LIMIT 1
    `),
  );
  return row as { internal_status: string; courier_status: string | null };
}

describe("D56 Phase 8 / Lane 2 — appliers dual-write courier_status (real Postgres)", () => {
  beforeAll(async () => {
    columnPresent = await hasCourierStatusColumn();
    if (!columnPresent) {
      // Lane 1's 0035 migration not applied here — skip the suite. See header.
      console.warn(
        "[D56 Lane 2] tasks.courier_status absent — skipping dual-write integration (Lane 1 0035 not applied)",
      );
      return;
    }

    await withServiceRole("D56 Lane 2 dual-write setup", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, status) VALUES
          (${TENANT}, ${SLUG}, 'CSD Lane2 Test', 'active')
      `);
      await tx.execute(sqlTag`
        INSERT INTO consignees (id, tenant_id, name, phone, address_line, emirate_or_region, district)
        VALUES
          (${CONSIGNEE}, ${TENANT}, 'CSD Test Consignee', ${`+97150${RUN_ID}`},
           'Test Building', 'Dubai', 'Test District')
      `);
      // FINEONLY + REGRESS are pre-seeded mid-ramp on the fine column so the
      // coarse-no-op / regress-block scenarios start from a known fine state.
      await tx.execute(sqlTag`
        INSERT INTO tasks (
          id, tenant_id, consignee_id, customer_order_number,
          external_id, external_tracking_number,
          internal_status, courier_status,
          delivery_date, delivery_start_time, delivery_end_time, created_via
        ) VALUES
          (${TASK_HAPPY}, ${TENANT}, ${CONSIGNEE}, ${`CSD-HAPPY-${RUN_ID}`},
           ${EXT_HAPPY}, ${AWB_HAPPY},
           'CREATED', NULL, '2026-05-09', '08:00', '10:00', 'manual_admin'),
          (${TASK_FINEONLY}, ${TENANT}, ${CONSIGNEE}, ${`CSD-FINE-${RUN_ID}`},
           ${EXT_FINEONLY}, ${AWB_FINEONLY},
           'IN_TRANSIT', 'PICKED_UP', '2026-05-09', '08:00', '10:00', 'manual_admin'),
          (${TASK_REGRESS}, ${TENANT}, ${CONSIGNEE}, ${`CSD-REGR-${RUN_ID}`},
           ${EXT_REGRESS}, ${AWB_REGRESS},
           'IN_TRANSIT', 'OUT_FOR_DELIVERY', '2026-05-09', '08:00', '10:00', 'manual_admin'),
          (${TASK_MASTER}, ${TENANT}, ${CONSIGNEE}, ${`CSD-MAST-${RUN_ID}`},
           ${EXT_MASTER}, ${AWB_MASTER},
           'CREATED', NULL, '2026-05-09', '08:00', '10:00', 'manual_admin'),
          (${TASK_SKIPPED}, ${TENANT}, ${CONSIGNEE}, ${`CSD-SKIP-${RUN_ID}`},
           ${EXT_SKIPPED}, ${AWB_SKIPPED},
           'SKIPPED', NULL, '2026-05-09', '08:00', '10:00', 'manual_admin')
      `);
    });
  });

  it("status event writes BOTH internal_status (coarse) and courier_status (fine)", async (ctx) => {
    if (!columnPresent) {
      ctx.skip();
      return;
    }
    const occurredAt = "2026-05-09T08:30:00.000Z";
    const result = await applyWebhookStatusEvent(
      TENANT,
      buildStatusEvent(AWB_HAPPY, occurredAt, "TASK_STATUS_UPDATED_TO_PICKED_UP"),
      "TASK_STATUS_UPDATED_TO_PICKED_UP",
    );
    expect(result.applied).toBe(true);

    const cols = await readColumns(TASK_HAPPY);
    expect(cols.internal_status).toBe("IN_TRANSIT");
    expect(cols.courier_status).toBe("PICKED_UP");
  });

  it("coarse column NO-OPS while the fine column advances within IN_TRANSIT (PICKED_UP -> OUT_FOR_DELIVERY)", async (ctx) => {
    if (!columnPresent) {
      ctx.skip();
      return;
    }
    const occurredAt = "2026-05-09T09:00:00.000Z";
    const result = await applyWebhookStatusEvent(
      TENANT,
      buildStatusEvent(AWB_FINEONLY, occurredAt, "TASK_STATUS_UPDATED_TO_OUT_FOR_DELIVERY"),
      "TASK_STATUS_UPDATED_TO_OUT_FOR_DELIVERY",
    );
    expect(result.applied).toBe(true);

    const cols = await readColumns(TASK_FINEONLY);
    expect(cols.internal_status).toBe("IN_TRANSIT"); // coarse unchanged (no-op)
    expect(cols.courier_status).toBe("OUT_FOR_DELIVERY"); // fine advanced
  });

  it("a lagging webhook cannot regress the fine column down the ramp (OUT_FOR_DELIVERY stays)", async (ctx) => {
    if (!columnPresent) {
      ctx.skip();
      return;
    }
    const occurredAt = "2026-05-09T09:30:00.000Z";
    await applyWebhookStatusEvent(
      TENANT,
      buildStatusEvent(AWB_REGRESS, occurredAt, "TASK_STATUS_UPDATED_TO_PICKED_UP"),
      "TASK_STATUS_UPDATED_TO_PICKED_UP",
    );

    const cols = await readColumns(TASK_REGRESS);
    expect(cols.courier_status).toBe("OUT_FOR_DELIVERY"); // not dragged back to PICKED_UP
  });

  it("edit-event master payload `status` field dual-writes the fine column", async (ctx) => {
    if (!columnPresent) {
      ctx.skip();
      return;
    }
    const occurredAt = "2026-05-09T10:00:00.000Z";
    const result = await applyWebhookEditEvent(
      TENANT,
      buildMasterEvent(AWB_MASTER, occurredAt, "OUT_FOR_DELIVERY"),
      "TASK_HAS_BEEN_UPDATED",
    );
    expect(result.applied).toBe(true);

    const cols = await readColumns(TASK_MASTER);
    expect(cols.internal_status).toBe("IN_TRANSIT"); // coarse value map
    expect(cols.courier_status).toBe("OUT_FOR_DELIVERY"); // fine value map
  });

  it("SKIPPED task: neither column is written (SQL guard covers the fine field too)", async (ctx) => {
    if (!columnPresent) {
      ctx.skip();
      return;
    }
    const occurredAt = "2026-05-09T10:30:00.000Z";
    await applyWebhookStatusEvent(
      TENANT,
      buildStatusEvent(AWB_SKIPPED, occurredAt, "TASK_STATUS_UPDATED_TO_DELIVERED"),
      "TASK_STATUS_UPDATED_TO_DELIVERED",
    );

    const cols = await readColumns(TASK_SKIPPED);
    expect(cols.internal_status).toBe("SKIPPED"); // operator-set wins
    expect(cols.courier_status).toBeNull(); // fine column not written either
  });
});
