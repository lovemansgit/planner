// tests/integration/webhook-receipt-split.spec.ts
// =============================================================================
// Day-53 R-C — receipt-then-apply transaction split.
// Plan: memory/plans/day-53-session-c-rc-receipt-tx-split.md §4 — real
// Postgres; contract memory/triage_five_races_findings.md §R-C.
//
// Cases pinned:
//   1. Induced Tx-2 failure, status path — a deliveryDate of 2026-13-45
//      passes the zod regex but throws at the Postgres date cast in the
//      task UPDATE. The webhook_events receipt must SURVIVE the apply
//      failure (before the split it rolled back with it); the task is
//      unchanged and no audit emits.
//   2. Orphan-slot semantics — re-delivering the same event after a
//      failed apply returns {applied:false, reason:"duplicate"} with
//      still exactly one receipt row (the documented §2 trade-off).
//   3. Induced Tx-2 failure, edit path — same vector through
//      applyWebhookEditEvent; receipt survives, task unchanged.
//   4. Happy-path regression, status path — valid event still applies:
//      receipt + status flip + audit emit (the split must not break the
//      normal flow).
//   5. Short-circuit regression — task_not_found keeps committing the
//      receipt (pre-existing forensic posture survives the restructure).
//
// Per-run isolation: random RUN_ID suffix; accepted-leak teardown per
// memory/followup_audit_rule_cascade_conflict.md.
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
const SLUG = `wrs-${RUN_ID}`;
const CONSIGNEE = randomUUID();

// The induction vector: passes ^\d{4}-\d{2}-\d{2}$ in BOTH files' zod
// schemas, fails the Postgres date cast in the task UPDATE.
const BAD_DATE = "2026-13-45";

const AWB_STATUS_FAIL = `WRS-${RUN_ID}-STATFAIL`;
const AWB_EDIT_FAIL = `WRS-${RUN_ID}-EDITFAIL`;
const AWB_HAPPY = `WRS-${RUN_ID}-HAPPY`;
const AWB_NOT_FOUND = `WRS-${RUN_ID}-MISSING`;

const TASK_STATUS_FAIL = randomUUID() as Uuid;
const TASK_EDIT_FAIL = randomUUID() as Uuid;
const TASK_HAPPY = randomUUID() as Uuid;

const EXT_ID_BASE = parseInt(RUN_ID, 16);

function buildEvent(awb: string, occurredAt: string, raw: Record<string, unknown>): WebhookEvent {
  return {
    kind: "TASK_STATUS_CHANGED",
    externalTaskId: awb,
    occurredAt,
    idempotencyKey: `key-${awb}-${occurredAt}`,
    raw: { awb, ...raw },
  };
}

type ReceiptRow = { id: string; action: string };

async function readReceipts(awb: string): Promise<readonly ReceiptRow[]> {
  return withServiceRole("wrs read receipts", async (tx) => {
    return (await tx.execute(sqlTag`
      SELECT id, action FROM webhook_events
      WHERE tenant_id = ${TENANT} AND suitefleet_task_id = ${awb}
    `)) as readonly ReceiptRow[];
  });
}

async function readTaskStatusAndDate(
  taskId: Uuid,
): Promise<{ internal_status: string; delivery_date: string }> {
  return withServiceRole("wrs read task", async (tx) => {
    const rows = (await tx.execute(sqlTag`
      SELECT internal_status, delivery_date::text AS delivery_date
      FROM tasks WHERE id = ${taskId}
    `)) as readonly { internal_status: string; delivery_date: string }[];
    return rows[0];
  });
}

async function countAuditRows(taskId: Uuid): Promise<number> {
  return withServiceRole("wrs count audits", async (tx) => {
    const rows = (await tx.execute(sqlTag`
      SELECT count(*)::int AS n FROM audit_events
      WHERE tenant_id = ${TENANT} AND resource_id = ${taskId}
    `)) as readonly { n: number }[];
    return rows[0].n;
  });
}

describe("Day-53 R-C — webhook receipt-then-apply split (real Postgres)", () => {
  beforeAll(async () => {
    await withServiceRole("wrs seed base", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, status) VALUES
          (${TENANT}, ${SLUG}, 'WRS R-C Test', 'active')
      `);
      await tx.execute(sqlTag`
        INSERT INTO consignees (id, tenant_id, name, phone, address_line, emirate_or_region, district)
        VALUES
          (${CONSIGNEE}, ${TENANT}, 'WRS Test Consignee', ${`+97151${RUN_ID}`},
           'Test Building', 'Dubai', 'Test District')
      `);
      await tx.execute(sqlTag`
        INSERT INTO tasks (
          id, tenant_id, consignee_id, customer_order_number,
          external_id, external_tracking_number,
          internal_status, delivery_date, delivery_start_time, delivery_end_time,
          created_via
        ) VALUES
          (${TASK_STATUS_FAIL}, ${TENANT}, ${CONSIGNEE}, ${`WRS-SF-${RUN_ID}`},
           ${String(EXT_ID_BASE + 1)}, ${AWB_STATUS_FAIL},
           'CREATED', '2026-05-09', '08:00', '10:00',
           'manual_admin'),
          (${TASK_EDIT_FAIL}, ${TENANT}, ${CONSIGNEE}, ${`WRS-EF-${RUN_ID}`},
           ${String(EXT_ID_BASE + 2)}, ${AWB_EDIT_FAIL},
           'CREATED', '2026-05-09', '08:00', '10:00',
           'manual_admin'),
          (${TASK_HAPPY}, ${TENANT}, ${CONSIGNEE}, ${`WRS-HP-${RUN_ID}`},
           ${String(EXT_ID_BASE + 3)}, ${AWB_HAPPY},
           'CREATED', '2026-05-09', '08:00', '10:00',
           'manual_admin')
      `);
    });
  });

  it("case 1 — status path: apply failure no longer erases the receipt", async () => {
    const occurredAt = "2026-05-09T08:30:00.000Z";
    const event = buildEvent(AWB_STATUS_FAIL, occurredAt, {
      action: "TASK_STATUS_UPDATED_TO_PICKED_UP",
      eventTimestamp: occurredAt,
      deliveryDate: BAD_DATE,
    });

    await expect(
      applyWebhookStatusEvent(TENANT, event, "TASK_STATUS_UPDATED_TO_PICKED_UP"),
    ).rejects.toThrow();

    // The receipt SURVIVES the failed apply (RED before the split:
    // the rollback erased it).
    const receipts = await readReceipts(AWB_STATUS_FAIL);
    expect(receipts.length).toBe(1);
    expect(receipts[0].action).toBe("TASK_STATUS_UPDATED_TO_PICKED_UP");

    // The apply itself rolled back alone: task untouched, no audit.
    const task = await readTaskStatusAndDate(TASK_STATUS_FAIL);
    expect(task.internal_status).toBe("CREATED");
    expect(task.delivery_date).toBe("2026-05-09");
    expect(await countAuditRows(TASK_STATUS_FAIL)).toBe(0);
  });

  it("case 2 — re-delivery after a failed apply returns duplicate; still one receipt row", async () => {
    const occurredAt = "2026-05-09T08:30:00.000Z";
    const event = buildEvent(AWB_STATUS_FAIL, occurredAt, {
      action: "TASK_STATUS_UPDATED_TO_PICKED_UP",
      eventTimestamp: occurredAt,
      deliveryDate: BAD_DATE,
    });

    const result = await applyWebhookStatusEvent(
      TENANT,
      event,
      "TASK_STATUS_UPDATED_TO_PICKED_UP",
    );
    expect(result).toEqual({ applied: false, reason: "duplicate" });
    expect((await readReceipts(AWB_STATUS_FAIL)).length).toBe(1);
  });

  it("case 3 — edit path: apply failure no longer erases the receipt", async () => {
    const occurredAt = "2026-05-09T11:00:00.000Z";
    const event = buildEvent(AWB_EDIT_FAIL, occurredAt, {
      action: "TASK_HAS_BEEN_UPDATED",
      eventTimestamp: occurredAt,
      deliveryDate: BAD_DATE,
    });

    await expect(
      applyWebhookEditEvent(TENANT, event, "TASK_HAS_BEEN_UPDATED"),
    ).rejects.toThrow();

    const receipts = await readReceipts(AWB_EDIT_FAIL);
    expect(receipts.length).toBe(1);
    expect(receipts[0].action).toBe("TASK_HAS_BEEN_UPDATED");

    const task = await readTaskStatusAndDate(TASK_EDIT_FAIL);
    expect(task.delivery_date).toBe("2026-05-09");
    expect(await countAuditRows(TASK_EDIT_FAIL)).toBe(0);
  });

  it("case 4 — happy-path regression: valid status event still applies end-to-end", async () => {
    const occurredAt = "2026-05-09T09:00:00.000Z";
    const event = buildEvent(AWB_HAPPY, occurredAt, {
      action: "TASK_STATUS_UPDATED_TO_PICKED_UP",
      eventTimestamp: occurredAt,
    });

    const result = await applyWebhookStatusEvent(
      TENANT,
      event,
      "TASK_STATUS_UPDATED_TO_PICKED_UP",
    );
    expect(result.applied).toBe(true);

    expect((await readReceipts(AWB_HAPPY)).length).toBe(1);
    const task = await readTaskStatusAndDate(TASK_HAPPY);
    expect(task.internal_status).toBe("IN_TRANSIT");
    expect(await countAuditRows(TASK_HAPPY)).toBe(1);
  });

  it("case 5 — short-circuit regression: task_not_found still commits the receipt", async () => {
    const occurredAt = "2026-05-09T10:00:00.000Z";
    const event = buildEvent(AWB_NOT_FOUND, occurredAt, {
      action: "TASK_STATUS_UPDATED_TO_PICKED_UP",
      eventTimestamp: occurredAt,
    });

    const result = await applyWebhookStatusEvent(
      TENANT,
      event,
      "TASK_STATUS_UPDATED_TO_PICKED_UP",
    );
    expect(result).toEqual({ applied: false, reason: "task_not_found" });
    expect((await readReceipts(AWB_NOT_FOUND)).length).toBe(1);
  });
});
