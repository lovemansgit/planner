// tests/integration/webhook-status-from-master-payload.spec.ts
// =============================================================================
// Day-67 P1 — status advancement from the master TASK_HAS_BEEN_UPDATED payload
// + the monotonic/terminal guard shared by both appliers (real Postgres).
//
// Root cause (memory/followup_inbound_status_webhook_master_payload.md): SF
// carries the live driver status in a TOP-LEVEL `status` field on EVERY
// webhook, including the master TASK_HAS_BEEN_UPDATED. Planner previously
// advanced internal_status only from the dedicated TASK_STATUS_UPDATED_TO_*
// ACTION string, so a tenant subscribed only to the master webhook never left
// CREATED though SF was sending the status on every payload.
//
// Pins:
//   1. REPRO/FIX — master TASK_HAS_BEEN_UPDATED with status=PICKED_UP on a
//      CREATED task advances internal_status to IN_TRANSIT + emits
//      task.status_changed_via_webhook. (Pre-fix: stayed CREATED, no emit.)
//   2. Monotonic guard (master) — status=OUT_FOR_DELIVERY on a DELIVERED task
//      does NOT regress; stays DELIVERED.
//   3. SKIPPED preserved (master) — status=PICKED_UP on a SKIPPED task is
//      ignored; stays SKIPPED.
//   4. no_diff (master) — status=ORDERED (==CREATED) with no field edits on a
//      CREATED task returns no_diff (no advance, no column move).
//   5. Monotonic guard (dedicated) — TASK_STATUS_UPDATED_TO_OUT_FOR_DELIVERY on
//      a DELIVERED task returns status_not_advanced; stays DELIVERED.
//   6. POD decoupling — master DELIVERED (no photos) advances to DELIVERED;
//      then dedicated DELIVERED (photos) is status-guard-blocked but STILL
//      captures pod_photos (idempotent on pod_photos IS NULL).
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { withServiceRole } from "../../src/shared/db";
import { applyWebhookEditEvent } from "../../src/modules/integration/providers/suitefleet/apply-webhook-edit-event";
import { applyWebhookStatusEvent } from "../../src/modules/integration/providers/suitefleet/apply-webhook-status-event";
import type { WebhookEvent } from "../../src/modules/integration/types";
import type { Uuid } from "../../src/shared/types";

const RUN_ID = randomUUID().slice(0, 8);
const TENANT = randomUUID() as Uuid;
const SLUG = `wsmp-${RUN_ID}`;
const CONSIGNEE = randomUUID();
const ADDR = randomUUID();

const EXT_ID_BASE = parseInt(RUN_ID, 16);

// One task per scenario (distinct AWBs so cross-test interference is impossible).
const TASK_REPRO = randomUUID() as Uuid;
const TASK_NO_REGRESS = randomUUID() as Uuid;
const TASK_SKIPPED = randomUUID() as Uuid;
const TASK_NODIFF = randomUUID() as Uuid;
const TASK_DEDICATED = randomUUID() as Uuid;
const TASK_POD = randomUUID() as Uuid;
const TASK_RESCHEDULE = randomUUID() as Uuid;

const AWB_REPRO = `WSMP-${RUN_ID}-REPRO`;
const AWB_NO_REGRESS = `WSMP-${RUN_ID}-NOREGRESS`;
const AWB_SKIPPED = `WSMP-${RUN_ID}-SKIPPED`;
const AWB_NODIFF = `WSMP-${RUN_ID}-NODIFF`;
const AWB_DEDICATED = `WSMP-${RUN_ID}-DEDICATED`;
const AWB_POD = `WSMP-${RUN_ID}-POD`;
const AWB_RESCHEDULE = `WSMP-${RUN_ID}-RESCHED`;

// Master TASK_HAS_BEEN_UPDATED event carrying a top-level `status` field.
function buildMasterEvent(
  awb: string,
  occurredAt: string,
  raw: Record<string, unknown>
): WebhookEvent {
  return {
    kind: "TASK_STATUS_CHANGED",
    externalTaskId: awb,
    occurredAt,
    idempotencyKey: `key-${awb}-${occurredAt}-${randomUUID().slice(0, 6)}`,
    raw: { awb, action: "TASK_HAS_BEEN_UPDATED", eventTimestamp: occurredAt, ...raw },
  };
}

// Dedicated TASK_STATUS_UPDATED_TO_* status event.
function buildStatusEvent(
  awb: string,
  occurredAt: string,
  raw: Record<string, unknown>
): WebhookEvent {
  return {
    kind: "TASK_STATUS_CHANGED",
    externalTaskId: awb,
    occurredAt,
    idempotencyKey: `key-${awb}-${occurredAt}-${randomUUID().slice(0, 6)}`,
    raw: { awb, eventTimestamp: occurredAt, ...raw },
  };
}

async function readStatus(taskId: Uuid): Promise<string> {
  const [row] = await withServiceRole("wsmp read status", async (tx) =>
    tx.execute(sqlTag`SELECT internal_status FROM tasks WHERE id = ${taskId} LIMIT 1`)
  );
  return (row as { internal_status: string }).internal_status;
}

describe("Day-67 P1 — status from master payload + monotonic guard (real Postgres)", () => {
  beforeAll(async () => {
    await withServiceRole("wsmp setup", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, status)
        VALUES (${TENANT}, ${SLUG}, 'Master Status Test', 'active')
      `);
      await tx.execute(sqlTag`
        INSERT INTO consignees (id, tenant_id, name, phone, address_line, emirate_or_region, district)
        VALUES (${CONSIGNEE}, ${TENANT}, 'WSMP Consignee', ${`+97150wm${RUN_ID}`},
                'Test Building', 'Dubai', 'Test District')
      `);
      await tx.execute(sqlTag`
        INSERT INTO addresses (id, tenant_id, consignee_id, label, line, district, emirate, is_primary)
        VALUES (${ADDR}, ${TENANT}, ${CONSIGNEE}, 'home', 'Tower 1', 'Marina', 'Dubai', true)
      `);
      await tx.execute(sqlTag`
        INSERT INTO tasks (
          id, tenant_id, consignee_id, customer_order_number,
          external_id, external_tracking_number, address_id,
          internal_status, delivery_date, delivery_start_time, delivery_end_time, created_via
        ) VALUES
          (${TASK_REPRO}, ${TENANT}, ${CONSIGNEE}, ${`WSMP-REPRO-${RUN_ID}`},
           ${String(EXT_ID_BASE + 1)}, ${AWB_REPRO}, ${ADDR},
           'CREATED', '2026-06-19', '08:00:00', '10:00:00', 'manual_admin'),
          (${TASK_NO_REGRESS}, ${TENANT}, ${CONSIGNEE}, ${`WSMP-NOREG-${RUN_ID}`},
           ${String(EXT_ID_BASE + 2)}, ${AWB_NO_REGRESS}, ${ADDR},
           'DELIVERED', '2026-06-19', '08:00:00', '10:00:00', 'manual_admin'),
          (${TASK_SKIPPED}, ${TENANT}, ${CONSIGNEE}, ${`WSMP-SKIP-${RUN_ID}`},
           ${String(EXT_ID_BASE + 3)}, ${AWB_SKIPPED}, ${ADDR},
           'SKIPPED', '2026-06-19', '08:00:00', '10:00:00', 'manual_admin'),
          (${TASK_NODIFF}, ${TENANT}, ${CONSIGNEE}, ${`WSMP-NODIFF-${RUN_ID}`},
           ${String(EXT_ID_BASE + 4)}, ${AWB_NODIFF}, ${ADDR},
           'CREATED', '2026-06-19', '08:00:00', '10:00:00', 'manual_admin'),
          (${TASK_DEDICATED}, ${TENANT}, ${CONSIGNEE}, ${`WSMP-DED-${RUN_ID}`},
           ${String(EXT_ID_BASE + 5)}, ${AWB_DEDICATED}, ${ADDR},
           'DELIVERED', '2026-06-19', '08:00:00', '10:00:00', 'manual_admin'),
          (${TASK_POD}, ${TENANT}, ${CONSIGNEE}, ${`WSMP-POD-${RUN_ID}`},
           ${String(EXT_ID_BASE + 6)}, ${AWB_POD}, ${ADDR},
           'IN_TRANSIT', '2026-06-19', '08:00:00', '10:00:00', 'manual_admin'),
          (${TASK_RESCHEDULE}, ${TENANT}, ${CONSIGNEE}, ${`WSMP-RESCHED-${RUN_ID}`},
           ${String(EXT_ID_BASE + 7)}, ${AWB_RESCHEDULE}, ${ADDR},
           'IN_TRANSIT', '2026-06-19', '08:00:00', '10:00:00', 'manual_admin')
      `);
    });
  });

  it("REPRO/FIX — master TASK_HAS_BEEN_UPDATED with status=PICKED_UP advances CREATED → IN_TRANSIT + emits status_changed", async () => {
    expect(await readStatus(TASK_REPRO)).toBe("CREATED");

    const event = buildMasterEvent(AWB_REPRO, "2026-06-19T12:44:10.000Z", {
      status: "PICKED_UP",
    });
    const result = await applyWebhookEditEvent(TENANT, event, "TASK_HAS_BEEN_UPDATED");

    expect(result.applied).toBe(true);
    expect(await readStatus(TASK_REPRO)).toBe("IN_TRANSIT");

    const auditRows = await withServiceRole("wsmp repro audit", async (tx) =>
      tx.execute(sqlTag`
        SELECT event_type, metadata FROM audit_events
        WHERE tenant_id = ${TENANT} AND resource_id = ${TASK_REPRO}
          AND event_type = 'task.status_changed_via_webhook'
      `)
    );
    expect(auditRows.length).toBe(1);
    const meta = (auditRows[0] as { metadata: Record<string, unknown> }).metadata;
    expect(meta.previous_status).toBe("CREATED");
    expect(meta.new_status).toBe("IN_TRANSIT");
    expect(meta.sf_action).toBe("TASK_HAS_BEEN_UPDATED");
  });

  it("terminal guard (master) — status=OUT_FOR_DELIVERY does NOT move a DELIVERED task", async () => {
    expect(await readStatus(TASK_NO_REGRESS)).toBe("DELIVERED");

    const event = buildMasterEvent(AWB_NO_REGRESS, "2026-06-19T12:59:00.000Z", {
      status: "OUT_FOR_DELIVERY",
    });
    const result = await applyWebhookEditEvent(TENANT, event, "TASK_HAS_BEEN_UPDATED");

    // No field edits + no status advance ⇒ no_diff.
    expect(result.applied).toBe(false);
    expect(await readStatus(TASK_NO_REGRESS)).toBe("DELIVERED");
  });

  it("SKIPPED preserved (master) — status=PICKED_UP never overwrites an operator-set SKIPPED task", async () => {
    expect(await readStatus(TASK_SKIPPED)).toBe("SKIPPED");

    const event = buildMasterEvent(AWB_SKIPPED, "2026-06-19T12:44:10.000Z", {
      status: "PICKED_UP",
    });
    const result = await applyWebhookEditEvent(TENANT, event, "TASK_HAS_BEEN_UPDATED");

    expect(result.applied).toBe(false);
    expect(await readStatus(TASK_SKIPPED)).toBe("SKIPPED");
  });

  it("no_diff (master) — status=ORDERED (==CREATED) on a CREATED task with no field edits", async () => {
    const event = buildMasterEvent(AWB_NODIFF, "2026-06-19T12:10:00.000Z", {
      status: "ORDERED",
    });
    const result = await applyWebhookEditEvent(TENANT, event, "TASK_HAS_BEEN_UPDATED");

    expect(result.applied).toBe(false);
    if (!result.applied) expect(result.reason).toBe("no_diff");
    expect(await readStatus(TASK_NODIFF)).toBe("CREATED");
  });

  it("terminal guard (dedicated) — TASK_STATUS_UPDATED_TO_OUT_FOR_DELIVERY does NOT move a DELIVERED task (webhook still consumed)", async () => {
    expect(await readStatus(TASK_DEDICATED)).toBe("DELIVERED");

    const event = buildStatusEvent(AWB_DEDICATED, "2026-06-19T13:00:00.000Z", {
      action: "TASK_STATUS_UPDATED_TO_OUT_FOR_DELIVERY",
    });
    const result = await applyWebhookStatusEvent(
      TENANT,
      event,
      "TASK_STATUS_UPDATED_TO_OUT_FOR_DELIVERY"
    );

    // Webhook is consumed (applied:true — documented contract), but the
    // monotonic/terminal guard blocks the status write: stays DELIVERED.
    expect(result.applied).toBe(true);
    expect(await readStatus(TASK_DEDICATED)).toBe("DELIVERED");
  });

  it("POD decoupling — master DELIVERED (no photos) advances; later dedicated DELIVERED (photos) is status-guard-blocked but still captures POD", async () => {
    expect(await readStatus(TASK_POD)).toBe("IN_TRANSIT");

    // Master DELIVERED, photos absent — advances status, no POD.
    const master = buildMasterEvent(AWB_POD, "2026-06-19T13:42:00.000Z", {
      status: "DELIVERED",
    });
    const masterResult = await applyWebhookEditEvent(TENANT, master, "TASK_HAS_BEEN_UPDATED");
    expect(masterResult.applied).toBe(true);
    expect(await readStatus(TASK_POD)).toBe("DELIVERED");

    const [preDed] = await withServiceRole("wsmp pod pre", async (tx) =>
      tx.execute(sqlTag`SELECT pod_photos FROM tasks WHERE id = ${TASK_POD} LIMIT 1`)
    );
    expect((preDed as { pod_photos: unknown }).pod_photos).toBeNull();

    // Dedicated DELIVERED with photos — status guard blocks (already
    // DELIVERED) but POD must still land (pod_photos was NULL).
    const dedicated = buildStatusEvent(AWB_POD, "2026-06-19T13:43:00.000Z", {
      action: "TASK_STATUS_UPDATED_TO_DELIVERED",
      deliveryInformation: {
        photos: ["https://sf.example.com/pod-a.jpg", "https://sf.example.com/pod-b.jpg"],
      },
    });
    const dedicatedResult = await applyWebhookStatusEvent(
      TENANT,
      dedicated,
      "TASK_STATUS_UPDATED_TO_DELIVERED"
    );
    // Webhook consumed (applied:true); the status guard blocked the (no-op)
    // status write, but the decoupled POD write still captured the photos.
    expect(dedicatedResult.applied).toBe(true);

    const [postDed] = await withServiceRole("wsmp pod post", async (tx) =>
      tx.execute(sqlTag`SELECT pod_photos FROM tasks WHERE id = ${TASK_POD} LIMIT 1`)
    );
    const pod = (postDed as { pod_photos: unknown }).pod_photos;
    expect(Array.isArray(pod)).toBe(true);
    expect((pod as unknown[]).length).toBe(2);
  });

  it("Love-ruled — a rescheduled In-transit parcel ADVANCES to On-hold (real transition, not dropped)", async () => {
    expect(await readStatus(TASK_RESCHEDULE)).toBe("IN_TRANSIT");

    // SF `status` value RESCHEDULED maps to ON_HOLD. Per Love's 2026-06-19
    // ruling this real transition must move the displayed status — it is NOT a
    // backward move to be blocked (ON_HOLD is off the forward-linear spine).
    const event = buildMasterEvent(AWB_RESCHEDULE, "2026-06-19T13:10:00.000Z", {
      status: "RESCHEDULED",
    });
    const result = await applyWebhookEditEvent(TENANT, event, "TASK_HAS_BEEN_UPDATED");

    expect(result.applied).toBe(true);
    expect(await readStatus(TASK_RESCHEDULE)).toBe("ON_HOLD");
  });
});
