// tests/integration/webhook-edit-event-applied.spec.ts
// =============================================================================
// Day-18 / A2 Layer 3 — applyWebhookEditEvent integration coverage.
//
// Pins the real-Postgres behaviour of the webhook edit-event applier:
//   1. Happy path — TASK_HAS_BEEN_UPDATED with new delivery_date /
//      times → tasks columns updated; audit event with changed_fields
//      metadata.
//   2. All 9 extracted columns covered when payload populates them.
//   3. Address audit-only — consignee.location.* changes captured in
//      metadata as previous=null entry; tasks.address_id NOT mutated.
//   4. Deprecated fields IGNORED — bagsReturned, icePacksReturned
//      present in payload but neither extracted nor written.
//   5. Wrong-action returns wrong_action; no DB writes.
//   6. No-diff path — payload values match current row → no UPDATE,
//      no audit emit.
//   7. Idempotency — duplicate replay returns reason='duplicate'.
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { withServiceRole } from "../../src/shared/db";
import { applyWebhookEditEvent } from "../../src/modules/integration/providers/suitefleet/apply-webhook-edit-event";
import type { WebhookEvent } from "../../src/modules/integration/types";
import type { Uuid } from "../../src/shared/types";

const RUN_ID = randomUUID().slice(0, 8);
const TENANT = randomUUID() as Uuid;
const SLUG = `wee-${RUN_ID}`;
const CONSIGNEE = randomUUID();

const AWB_TIME_EDIT = `WEE-${RUN_ID}-TIME`;
const AWB_FULL_FIELDS = `WEE-${RUN_ID}-FULL`;
const AWB_ADDRESS_AUDIT = `WEE-${RUN_ID}-ADDR`;
const AWB_DEPRECATED = `WEE-${RUN_ID}-DEPR`;
const AWB_NO_DIFF = `WEE-${RUN_ID}-NODIFF`;

const TASK_TIME_EDIT = randomUUID() as Uuid;
const TASK_FULL_FIELDS = randomUUID() as Uuid;
const TASK_ADDRESS_AUDIT = randomUUID() as Uuid;
const TASK_DEPRECATED = randomUUID() as Uuid;
const TASK_NO_DIFF = randomUUID() as Uuid;

// Numeric placeholders for tasks.external_id — production stores SF numeric
// IDs here while AWB strings live on tasks.external_tracking_number.
const EXT_ID_BASE = parseInt(RUN_ID, 16);
const EXT_ID_TIME_EDIT = String(EXT_ID_BASE + 1);
const EXT_ID_FULL_FIELDS = String(EXT_ID_BASE + 2);
const EXT_ID_ADDRESS_AUDIT = String(EXT_ID_BASE + 3);
const EXT_ID_DEPRECATED = String(EXT_ID_BASE + 4);
const EXT_ID_NO_DIFF = String(EXT_ID_BASE + 5);

function buildEditEvent(awb: string, occurredAt: string, raw: Record<string, unknown>): WebhookEvent {
  return {
    kind: "TASK_STATUS_CHANGED",
    externalTaskId: awb,
    occurredAt,
    idempotencyKey: `key-${awb}-${occurredAt}`,
    raw: { awb, action: "TASK_HAS_BEEN_UPDATED", eventTimestamp: occurredAt, ...raw },
  };
}

describe("Day-18 / A2 Layer 3 — applyWebhookEditEvent (real Postgres)", () => {
  beforeAll(async () => {
    await withServiceRole("Day-18 A2 Layer-3 integration setup", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, status) VALUES
          (${TENANT}, ${SLUG}, 'WEE A2 L3 Test', 'active')
      `);
      await tx.execute(sqlTag`
        INSERT INTO consignees (id, tenant_id, name, phone, address_line, emirate_or_region, district)
        VALUES
          (${CONSIGNEE}, ${TENANT}, 'WEE Test Consignee', ${`+97150e${RUN_ID}`},
           'Test Building', 'Dubai', 'Test District')
      `);
      await tx.execute(sqlTag`
        INSERT INTO tasks (
          id, tenant_id, consignee_id, customer_order_number,
          external_id, external_tracking_number,
          internal_status, delivery_date, delivery_start_time, delivery_end_time,
          created_via
        ) VALUES
          (${TASK_TIME_EDIT}, ${TENANT}, ${CONSIGNEE}, ${`WEE-T-${RUN_ID}`},
           ${EXT_ID_TIME_EDIT}, ${AWB_TIME_EDIT},
           'CREATED', '2026-05-09', '08:00', '10:00', 'manual_admin'),
          (${TASK_FULL_FIELDS}, ${TENANT}, ${CONSIGNEE}, ${`WEE-F-${RUN_ID}`},
           ${EXT_ID_FULL_FIELDS}, ${AWB_FULL_FIELDS},
           'CREATED', '2026-05-09', '08:00', '10:00', 'manual_admin'),
          (${TASK_ADDRESS_AUDIT}, ${TENANT}, ${CONSIGNEE}, ${`WEE-A-${RUN_ID}`},
           ${EXT_ID_ADDRESS_AUDIT}, ${AWB_ADDRESS_AUDIT},
           'CREATED', '2026-05-09', '08:00', '10:00', 'manual_admin'),
          (${TASK_DEPRECATED}, ${TENANT}, ${CONSIGNEE}, ${`WEE-D-${RUN_ID}`},
           ${EXT_ID_DEPRECATED}, ${AWB_DEPRECATED},
           'CREATED', '2026-05-09', '08:00', '10:00', 'manual_admin'),
          (${TASK_NO_DIFF}, ${TENANT}, ${CONSIGNEE}, ${`WEE-N-${RUN_ID}`},
           ${EXT_ID_NO_DIFF}, ${AWB_NO_DIFF},
           'CREATED', '2026-05-09', '08:00', '10:00', 'manual_admin')
      `);
    });
  });

  // ---------------------------------------------------------------------------
  // 1. Happy path — time-window edit
  // ---------------------------------------------------------------------------

  it("happy path — delivery_date + start/end time edits land on the row", async () => {
    const occurredAt = "2026-05-09T11:00:00.000Z";
    const event = buildEditEvent(AWB_TIME_EDIT, occurredAt, {
      // C1 fixture update: time strings tightened to canonical HH:MM:SS per
      // locked §5.2 regex. Payload date key still snake_case here — C2 fixes
      // both the line-247 source AND this fixture to camelCase deliveryDate.
      delivery_date: "2026-05-12",
      deliveryStartTime: "14:00:00",
      deliveryEndTime: "16:00:00",
    });

    const result = await applyWebhookEditEvent(TENANT, event, "TASK_HAS_BEEN_UPDATED");
    expect(result.applied).toBe(true);
    if (result.applied) {
      expect(result.changedFieldCount).toBe(3);
    }

    const [task] = await withServiceRole("verify time-edit row", async (tx) =>
      tx.execute(sqlTag`
        SELECT delivery_date, delivery_start_time, delivery_end_time
        FROM tasks WHERE id = ${TASK_TIME_EDIT}
        LIMIT 1
      `),
    );
    expect((task as { delivery_date: string }).delivery_date).toMatch(/2026-05-12/);
    expect((task as { delivery_start_time: string }).delivery_start_time).toBe("14:00:00");
    expect((task as { delivery_end_time: string }).delivery_end_time).toBe("16:00:00");

    const [audit] = await withServiceRole("verify edit audit", async (tx) =>
      tx.execute(sqlTag`
        SELECT event_type, metadata FROM audit_events
        WHERE event_type = 'task.edit_applied_via_webhook'
          AND tenant_id = ${TENANT}
          AND resource_id = ${TASK_TIME_EDIT}
        ORDER BY occurred_at DESC LIMIT 1
      `),
    );
    expect((audit as { event_type: string }).event_type).toBe("task.edit_applied_via_webhook");
    const meta = (audit as { metadata: Record<string, unknown> }).metadata;
    const changedFields = meta.changed_fields as readonly { field: string }[];
    expect(changedFields.map((c) => c.field).sort()).toEqual([
      "delivery_date",
      "delivery_end_time",
      "delivery_start_time",
    ]);
  });

  // ---------------------------------------------------------------------------
  // 2. All 9 extracted columns
  // ---------------------------------------------------------------------------

  it("populates all 9 extracted columns from deliveryInformation block", async () => {
    const occurredAt = "2026-05-09T11:30:00.000Z";
    const event = buildEditEvent(AWB_FULL_FIELDS, occurredAt, {
      deliveryInformation: {
        recipientName: "Test Recipient",
        signature: "data:base64,test",
        consigneeRating: 5,
        consigneeComment: "Great delivery",
        driverComment: "Smooth handoff",
        numberOfAttempts: 1,
        failureReasonComment: null,
        completionLatitude: 25.197,
        completionLongitude: 55.274,
      },
    });

    const result = await applyWebhookEditEvent(TENANT, event, "TASK_HAS_BEEN_UPDATED");
    expect(result.applied).toBe(true);

    const [task] = await withServiceRole("verify all 9 columns", async (tx) =>
      tx.execute(sqlTag`
        SELECT recipient_name, signature, consignee_rating, consignee_comment,
               driver_comment, number_of_attempts, failure_reason_comment,
               completion_latitude, completion_longitude
        FROM tasks WHERE id = ${TASK_FULL_FIELDS} LIMIT 1
      `),
    );
    const t = task as Record<string, unknown>;
    expect(t.recipient_name).toBe("Test Recipient");
    expect(t.signature).toBe("data:base64,test");
    expect(t.consignee_rating).toBe(5);
    expect(t.consignee_comment).toBe("Great delivery");
    expect(t.driver_comment).toBe("Smooth handoff");
    expect(t.number_of_attempts).toBe(1);
    // failure_reason_comment is null in payload → undefined in extracted
    // → no diff written → column stays NULL.
    expect(t.failure_reason_comment).toBeNull();
    // numeric columns come back as strings from postgres-js.
    expect(Number(t.completion_latitude)).toBe(25.197);
    expect(Number(t.completion_longitude)).toBe(55.274);
  });

  // ---------------------------------------------------------------------------
  // 3. Address audit-only (plan §4.3 ruling: Option (ii))
  // ---------------------------------------------------------------------------

  it("address payload captured in audit metadata (previous=null) but tasks.address_id NOT mutated", async () => {
    const occurredAt = "2026-05-09T12:00:00.000Z";
    const event = buildEditEvent(AWB_ADDRESS_AUDIT, occurredAt, {
      consignee: {
        name: "Synthetic",
        location: {
          addressLine1: "New Building 99",
          district: "New District",
          city: "Dubai",
          countryCode: "AE",
        },
      },
    });

    const result = await applyWebhookEditEvent(TENANT, event, "TASK_HAS_BEEN_UPDATED");
    expect(result.applied).toBe(true);

    // tasks.address_id must remain NULL (or whatever it was).
    const [task] = await withServiceRole("verify address_id unchanged", async (tx) =>
      tx.execute(sqlTag`SELECT address_id FROM tasks WHERE id = ${TASK_ADDRESS_AUDIT} LIMIT 1`),
    );
    expect((task as { address_id: unknown }).address_id).toBeNull();

    // Audit metadata must include the address entry with previous=null.
    const [audit] = await withServiceRole("verify address audit metadata", async (tx) =>
      tx.execute(sqlTag`
        SELECT metadata FROM audit_events
        WHERE event_type = 'task.edit_applied_via_webhook'
          AND tenant_id = ${TENANT}
          AND resource_id = ${TASK_ADDRESS_AUDIT}
        ORDER BY occurred_at DESC LIMIT 1
      `),
    );
    const meta = (audit as { metadata: Record<string, unknown> }).metadata;
    const changedFields = meta.changed_fields as readonly { field: string; previous: unknown; new: unknown }[];
    const addressEntry = changedFields.find((c) => c.field === "address");
    expect(addressEntry).toBeDefined();
    expect(addressEntry?.previous).toBeNull();
    expect(addressEntry?.new).toMatchObject({ addressLine1: "New Building 99" });
  });

  // ---------------------------------------------------------------------------
  // 4. Deprecated fields ignored
  // ---------------------------------------------------------------------------

  it("ignores deliveryInformation.bagsReturned + icePacksReturned (deprecated)", async () => {
    const occurredAt = "2026-05-09T12:30:00.000Z";
    const event = buildEditEvent(AWB_DEPRECATED, occurredAt, {
      deliveryInformation: {
        bagsReturned: 5,
        icePacksReturned: 3,
        recipientName: "Should Land",
      },
    });

    const result = await applyWebhookEditEvent(TENANT, event, "TASK_HAS_BEEN_UPDATED");
    expect(result.applied).toBe(true);

    // recipient_name lands; bags/ice are not stored anywhere on tasks.
    const [task] = await withServiceRole("verify deprecated ignored", async (tx) =>
      tx.execute(sqlTag`SELECT recipient_name FROM tasks WHERE id = ${TASK_DEPRECATED} LIMIT 1`),
    );
    expect((task as { recipient_name: string }).recipient_name).toBe("Should Land");

    // Audit metadata must not list 'bags_returned' or 'ice_packs_returned'
    // as changed_fields entries.
    const [audit] = await withServiceRole("verify deprecated absent from audit", async (tx) =>
      tx.execute(sqlTag`
        SELECT metadata FROM audit_events
        WHERE event_type = 'task.edit_applied_via_webhook'
          AND tenant_id = ${TENANT}
          AND resource_id = ${TASK_DEPRECATED}
        ORDER BY occurred_at DESC LIMIT 1
      `),
    );
    const meta = (audit as { metadata: Record<string, unknown> }).metadata;
    const fieldNames = (meta.changed_fields as readonly { field: string }[]).map((c) => c.field);
    expect(fieldNames).not.toContain("bags_returned");
    expect(fieldNames).not.toContain("ice_packs_returned");
    expect(fieldNames).toContain("recipient_name");
  });

  // ---------------------------------------------------------------------------
  // 5. Wrong-action skip
  // ---------------------------------------------------------------------------

  it("returns wrong_action when sfAction is not TASK_HAS_BEEN_UPDATED", async () => {
    const occurredAt = "2026-05-09T13:00:00.000Z";
    const event = buildEditEvent(AWB_TIME_EDIT, occurredAt, { delivery_date: "2026-05-13" });

    const result = await applyWebhookEditEvent(
      TENANT,
      event,
      "TASK_STATUS_UPDATED_TO_DELIVERED",
    );
    expect(result.applied).toBe(false);
    if (!result.applied) {
      expect(result.reason).toBe("wrong_action");
    }
  });

  // ---------------------------------------------------------------------------
  // 6. No-diff path
  // ---------------------------------------------------------------------------

  it("returns no_diff when payload values match the current row state", async () => {
    const occurredAt = "2026-05-09T13:30:00.000Z";
    // The seed has delivery_date = '2026-05-09', start = '08:00', end = '10:00'.
    // Send the same values; no field changes.
    const event = buildEditEvent(AWB_NO_DIFF, occurredAt, {
      delivery_date: "2026-05-09",
      deliveryStartTime: "08:00:00",
      deliveryEndTime: "10:00:00",
    });

    const result = await applyWebhookEditEvent(TENANT, event, "TASK_HAS_BEEN_UPDATED");
    expect(result.applied).toBe(false);
    if (!result.applied) {
      expect(result.reason).toBe("no_diff");
    }

    // No audit emit for this task.
    const audits = await withServiceRole("verify no audit emit on no-diff", async (tx) =>
      tx.execute(sqlTag`
        SELECT id FROM audit_events
        WHERE event_type = 'task.edit_applied_via_webhook'
          AND tenant_id = ${TENANT}
          AND resource_id = ${TASK_NO_DIFF}
      `),
    );
    expect(audits).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // 7. Idempotency
  // ---------------------------------------------------------------------------

  it("duplicate edit-event replay returns reason='duplicate'", async () => {
    const occurredAt = "2026-05-09T11:00:00.000Z"; // same as test 1
    const event = buildEditEvent(AWB_TIME_EDIT, occurredAt, {
      delivery_date: "2026-05-12",
      deliveryStartTime: "14:00:00",
      deliveryEndTime: "16:00:00",
    });

    const result = await applyWebhookEditEvent(TENANT, event, "TASK_HAS_BEEN_UPDATED");
    expect(result.applied).toBe(false);
    if (!result.applied) {
      expect(result.reason).toBe("duplicate");
    }
  });

  // ---------------------------------------------------------------------------
  // I4 (plan PR #294 §5.3 + §6.2) — payload_validation_failed path.
  //
  // Non-canonical date string (ISO datetime variant `2026-06-01T00:00:00Z`)
  // is rejected by the boundary Zod schema's YYYY-MM-DD regex per locked
  // §5.2. The function returns the new structured outcome reason
  // 'payload_validation_failed' (Option A per locked §5.3 — NOT throw); the
  // webhook_events forensic row is preserved (INSERT runs before the parse
  // gate); no audit row emitted; no tasks UPDATE.
  // ---------------------------------------------------------------------------

  it("I4 — non-canonical deliveryDate (ISO datetime variant) returns payload_validation_failed", async () => {
    const occurredAt = "2026-05-09T14:00:00.000Z";
    const AWB_I4 = `WEE-${RUN_ID}-I4`;
    const EXT_ID_I4 = String(EXT_ID_BASE + 99);
    const TASK_I4 = randomUUID() as Uuid;

    // Seed a task to ensure the gate isn't `task_not_found` (we want to prove
    // the parser-rejection short-circuits BEFORE the task SELECT).
    await withServiceRole("seed I4 task", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tasks (
          id, tenant_id, consignee_id, customer_order_number,
          external_id, external_tracking_number,
          internal_status, delivery_date, delivery_start_time, delivery_end_time,
          created_via
        ) VALUES (
          ${TASK_I4}, ${TENANT}, ${CONSIGNEE}, ${`WEE-I4-${RUN_ID}`},
          ${EXT_ID_I4}, ${AWB_I4},
          'CREATED', '2026-05-09', '08:00', '10:00', 'manual_admin'
        )
      `);
    });

    const event = buildEditEvent(AWB_I4, occurredAt, {
      deliveryDate: "2026-06-01T00:00:00Z", // ISO datetime variant — rejected
    });

    const result = await applyWebhookEditEvent(TENANT, event, "TASK_HAS_BEEN_UPDATED");
    expect(result.applied).toBe(false);
    if (!result.applied) {
      expect(result.reason).toBe("payload_validation_failed");
    }

    // webhook_events row preserved (tx committed via structured return).
    const webhookRows = await withServiceRole("verify webhook_events preserved on I4", async (tx) =>
      tx.execute(sqlTag`
        SELECT id, raw_payload FROM webhook_events
        WHERE tenant_id = ${TENANT}
          AND suitefleet_task_id = ${AWB_I4}
          AND action = 'TASK_HAS_BEEN_UPDATED'
      `),
    );
    expect(webhookRows).toHaveLength(1);
    const raw = (webhookRows[0] as { raw_payload: Record<string, unknown> }).raw_payload;
    expect(raw.deliveryDate).toBe("2026-06-01T00:00:00Z");

    // No audit row emitted for this task.
    const audits = await withServiceRole("verify no audit emit on I4", async (tx) =>
      tx.execute(sqlTag`
        SELECT id FROM audit_events
        WHERE event_type = 'task.edit_applied_via_webhook'
          AND tenant_id = ${TENANT}
          AND resource_id = ${TASK_I4}
      `),
    );
    expect(audits).toEqual([]);

    // tasks row unchanged.
    const [task] = await withServiceRole("verify task row unchanged on I4", async (tx) =>
      tx.execute(sqlTag`
        SELECT delivery_date FROM tasks WHERE id = ${TASK_I4} LIMIT 1
      `),
    );
    expect((task as { delivery_date: string }).delivery_date).toMatch(/2026-05-09/);
  });
});
