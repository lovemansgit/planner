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
const AWB_NULL_TOL = `WEE-${RUN_ID}-NULL`;

const TASK_TIME_EDIT = randomUUID() as Uuid;
const TASK_FULL_FIELDS = randomUUID() as Uuid;
const TASK_ADDRESS_AUDIT = randomUUID() as Uuid;
const TASK_DEPRECATED = randomUUID() as Uuid;
const TASK_NO_DIFF = randomUUID() as Uuid;
const TASK_NULL_TOL = randomUUID() as Uuid;

// Numeric placeholders for tasks.external_id — production stores SF numeric
// IDs here while AWB strings live on tasks.external_tracking_number.
const EXT_ID_BASE = parseInt(RUN_ID, 16);
const EXT_ID_TIME_EDIT = String(EXT_ID_BASE + 1);
const EXT_ID_FULL_FIELDS = String(EXT_ID_BASE + 2);
const EXT_ID_ADDRESS_AUDIT = String(EXT_ID_BASE + 3);
const EXT_ID_DEPRECATED = String(EXT_ID_BASE + 4);
const EXT_ID_NO_DIFF = String(EXT_ID_BASE + 5);
const EXT_ID_NULL_TOL = String(EXT_ID_BASE + 50);

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

  it("happy path — deliveryDate + start/end time edits land on the row", async () => {
    const occurredAt = "2026-05-09T11:00:00.000Z";
    const event = buildEditEvent(AWB_TIME_EDIT, occurredAt, {
      // C2 fixture update: payload date key migrated to camelCase
      // deliveryDate (matches real SF wire format + the Bug 1 fix at the
      // line-247 source). Snake_case delivery_date is now an unknown root
      // key — silently stripped by the Zod parser per locked §6.1 U2.
      deliveryDate: "2026-05-12",
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
  // I2 (plan PR #294 §6.2) — address-only no-op under locked X.A + Z.A.
  //
  // Replaces the pre-fix test 3 that asserted applied:true on an
  // address-only payload (Bug 2 behaviour: address audit-only entry
  // inflated changedFields → no_diff gate passed → outcome.applied flipped
  // → audit row fired with zero DB writes).
  //
  // Locked §4.2 X.A: outcome.applied = "≥1 column actually moved on the
  // row." Address-only payloads return no_diff (reuse vocabulary; no new
  // outcome reason; no new audit event). webhook_events row preserved
  // (forensic surface for the address mention).
  // ---------------------------------------------------------------------------

  it("I2 — address-only payload (no column moves) returns no_diff; no audit emit; webhook_events row preserved", async () => {
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
    expect(result.applied).toBe(false);
    if (!result.applied) {
      expect(result.reason).toBe("no_diff");
    }

    // tasks.address_id unchanged (was never mutated; X.A means "≥1 column
    // moved" — address mention doesn't qualify).
    const [task] = await withServiceRole("verify address_id unchanged", async (tx) =>
      tx.execute(sqlTag`SELECT address_id FROM tasks WHERE id = ${TASK_ADDRESS_AUDIT} LIMIT 1`),
    );
    expect((task as { address_id: unknown }).address_id).toBeNull();

    // ZERO task.edit_applied_via_webhook audit row for this task — the
    // contract change vs the pre-fix Bug-2 behaviour.
    const audits = await withServiceRole("verify no audit emit on I2", async (tx) =>
      tx.execute(sqlTag`
        SELECT id FROM audit_events
        WHERE event_type = 'task.edit_applied_via_webhook'
          AND tenant_id = ${TENANT}
          AND resource_id = ${TASK_ADDRESS_AUDIT}
      `),
    );
    expect(audits).toEqual([]);

    // webhook_events row preserved — address forensics live in raw_payload.
    const webhookRows = await withServiceRole("verify webhook_events preserved on I2", async (tx) =>
      tx.execute(sqlTag`
        SELECT raw_payload FROM webhook_events
        WHERE tenant_id = ${TENANT}
          AND suitefleet_task_id = ${AWB_ADDRESS_AUDIT}
          AND action = 'TASK_HAS_BEEN_UPDATED'
      `),
    );
    expect(webhookRows).toHaveLength(1);
    const raw = (webhookRows[0] as { raw_payload: Record<string, unknown> }).raw_payload;
    const consignee = raw.consignee as Record<string, unknown>;
    const location = consignee.location as Record<string, unknown>;
    expect(location.addressLine1).toBe("New Building 99");
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
    // Send the same values; no field changes. C4 fix: payload key migrated
    // to camelCase deliveryDate so the no-diff path is genuinely exercised
    // (post-C1 the Zod parser strips unknown snake_case keys per locked
    // §6.1 U2 — pre-C4 this test passed for the wrong reason because the
    // date payload was silently dropped before the comparison).
    const event = buildEditEvent(AWB_NO_DIFF, occurredAt, {
      deliveryDate: "2026-05-09",
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
      deliveryDate: "2026-05-12",
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

  // ---------------------------------------------------------------------------
  // I1 (plan PR #294 §6.2) — DMB-99123608 regression replay.
  //
  // Behavioural anchor for the lane (memory/followup_inbound_webhook_edit_apply_two_bugs.md):
  // operator changed delivery_date 2026-05-25 → 2026-06-01 in the SF
  // OpsPortal late Day-27 PM. SF emitted an outbound webhook to Planner;
  // Planner emitted a task.edit_applied_via_webhook audit row but
  // tasks.delivery_date stayed at 2026-05-25 and tasks.updated_at did not
  // advance.
  //
  // Post-fix (this PR's C2 + C3): camelCase deliveryDate is correctly
  // extracted via parsed shape; the date column actually moves; the
  // address audit-only mention rides along in audit metadata but does NOT
  // independently flip outcome.applied (X.A); the audit row fires exactly
  // ONCE with metadata.changed_fields containing BOTH the date change AND
  // the address mention.
  // ---------------------------------------------------------------------------

  it("I1 (DMB-99123608 regression) — camelCase deliveryDate + address payload → date column moves + audit metadata has both", async () => {
    const occurredAt = "2026-05-09T15:00:00.000Z";
    const AWB_I1 = `WEE-${RUN_ID}-I1`;
    const EXT_ID_I1 = String(EXT_ID_BASE + 7);
    const TASK_I1 = randomUUID() as Uuid;

    await withServiceRole("seed I1 task (DMB-99123608 surrogate)", async (tx) => {
      // C4 fix: time strings seeded as canonical HH:MM:SS (was '08:00' /
      // '10:00') to match post-fix canonical-time discipline. Removes a
      // latent seed-vs-stored-format trap; not a live failure here since
      // I1 does not assert on times.
      await tx.execute(sqlTag`
        INSERT INTO tasks (
          id, tenant_id, consignee_id, customer_order_number,
          external_id, external_tracking_number,
          internal_status, delivery_date, delivery_start_time, delivery_end_time,
          created_via
        ) VALUES (
          ${TASK_I1}, ${TENANT}, ${CONSIGNEE}, ${`WEE-I1-${RUN_ID}`},
          ${EXT_ID_I1}, ${AWB_I1},
          'CREATED', '2026-05-25', '08:00:00', '10:00:00', 'manual_admin'
        )
      `);
    });

    // Sanitized DMB-99123608 payload shape: camelCase deliveryDate +
    // consignee.location present (SF empirically sends this on every
    // TASK_HAS_BEEN_UPDATED webhook).
    const event = buildEditEvent(AWB_I1, occurredAt, {
      deliveryDate: "2026-06-01",
      consignee: {
        location: {
          addressLine1: "Tower 7, Marina",
          district: "Dubai Marina",
          city: "Dubai",
          countryCode: "AE",
        },
      },
    });

    const result = await applyWebhookEditEvent(TENANT, event, "TASK_HAS_BEEN_UPDATED");
    expect(result.applied).toBe(true);

    // Fact 3 + 4 of the diagnosed mechanism: post-fix, tasks.delivery_date
    // moves AND tasks.updated_at advances (UPDATE issued because
    // columnsToUpdate is non-empty under C3's decoupling).
    const [task] = await withServiceRole("verify I1 date moved + updated_at advanced", async (tx) =>
      tx.execute(sqlTag`
        SELECT delivery_date, updated_at, created_at FROM tasks WHERE id = ${TASK_I1} LIMIT 1
      `),
    );
    // C4 fix: load-bearing regression anchor for the headline bug. Strict
    // equality on the moved date column — fails loudly on any drift. The
    // YYYY-MM-DD prefix normalisation is defensive against postgres-js
    // driver-config variants that might serialise DATE columns differently;
    // the calendar date asserted is exact.
    const deliveryDateRaw = (task as { delivery_date: string }).delivery_date;
    expect(deliveryDateRaw.slice(0, 10)).toBe("2026-06-01");
    const updatedAt = new Date((task as { updated_at: string }).updated_at);
    const createdAt = new Date((task as { created_at: string }).created_at);
    expect(updatedAt.getTime()).toBeGreaterThan(createdAt.getTime());

    // Fact 2 of the diagnosed mechanism (post-fix variant): exactly ONE
    // task.edit_applied_via_webhook row for this task (not zero, not
    // multiple). Metadata.changed_fields includes BOTH the date column
    // move AND the address mention.
    const audits = await withServiceRole("verify I1 single audit emit + metadata shape", async (tx) =>
      tx.execute(sqlTag`
        SELECT metadata FROM audit_events
        WHERE event_type = 'task.edit_applied_via_webhook'
          AND tenant_id = ${TENANT}
          AND resource_id = ${TASK_I1}
      `),
    );
    expect(audits).toHaveLength(1);
    const meta = (audits[0] as { metadata: Record<string, unknown> }).metadata;
    const changedFields = meta.changed_fields as readonly { field: string; previous: unknown; new: unknown }[];
    const fieldNames = changedFields.map((c) => c.field).sort();
    expect(fieldNames).toContain("delivery_date");
    expect(fieldNames).toContain("address");
    const dateEntry = changedFields.find((c) => c.field === "delivery_date");
    expect(dateEntry?.new).toBe("2026-06-01");
    const addressEntry = changedFields.find((c) => c.field === "address");
    expect(addressEntry?.previous).toBeNull();
    expect(addressEntry?.new).toMatchObject({ addressLine1: "Tower 7, Marina" });
  });

  // ---------------------------------------------------------------------------
  // D29-NULL (plan #303 §6.1 + §6.2) — null-tolerance regression fixture.
  //
  // Behavioural anchor: PR #298's webhookEditPayloadSchema declared the 8
  // non-failureReasonComment deliveryInformation leaves as `.optional()` only;
  // SF empirically emits the block PRESENT-and-all-null for any
  // not-yet-delivered task, so each null leaf raised invalid_type and the
  // entire parse failed with zod_issue_count=8. Day-29 Phase-1.5 forensic
  // proved this from 12 real production webhook_events raw_payloads (10
  // historical TASK_HAS_BEEN_UPDATED + 2 cancel-twins).
  //
  // Fixture below is the VERBATIM SF wire shape from the corpus, with the
  // AWB rebranded to AWB_NULL_TOL per the existing test-pattern at the top
  // of this file. The load-bearing element — deliveryInformation present
  // with all 8 non-failureReasonComment leaves null + failureReasonComment
  // null — is byte-faithful to the AWB DMB-17621675 / 2026-05-19 wire shape
  // captured during the forensic pull.
  //
  // DO NOT "normalize" this fixture (replace nulls with strings, omit the
  // block, etc.). The all-null shape is the only shape that exercises the
  // regression. See memory/followup_inbound_webhook_null_tolerance_regression.md
  // for the full ground-truth narrative.
  // ---------------------------------------------------------------------------

  it("D29-NULL — all-null deliveryInformation block parses + delivery_date applies + 8 null columns untouched", async () => {
    const occurredAt = "2026-05-09T16:00:00.000Z";

    await withServiceRole("seed D29-NULL task (DMB-17621675 surrogate)", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tasks (
          id, tenant_id, consignee_id, customer_order_number,
          external_id, external_tracking_number,
          internal_status, delivery_date, delivery_start_time, delivery_end_time,
          recipient_name, signature, consignee_rating, consignee_comment,
          driver_comment, number_of_attempts,
          completion_latitude, completion_longitude,
          created_via
        ) VALUES (
          ${TASK_NULL_TOL}, ${TENANT}, ${CONSIGNEE}, ${`WEE-NULL-${RUN_ID}`},
          ${EXT_ID_NULL_TOL}, ${AWB_NULL_TOL},
          'CREATED', '2026-05-17', '08:00:00', '10:00:00',
          'Pre-Existing Recipient', 'data:base64,preexisting', 4, 'Pre-existing rating',
          'Pre-existing driver note', 0,
          25.100, 55.200,
          'manual_admin'
        )
      `);
    });

    // Verbatim wire shape — deliveryInformation present with all 8 non-
    // failureReasonComment leaves null + failureReasonComment null (9 nulls
    // total). This is what SF actually sends.
    const event = buildEditEvent(AWB_NULL_TOL, occurredAt, {
      deliveryDate: "2026-05-19",
      deliveryStartTime: "08:00:00",
      deliveryEndTime: "10:00:00",
      deliveryInformation: {
        recipientName: null,
        signature: null,
        consigneeRating: null,
        consigneeComment: null,
        driverComment: null,
        numberOfAttempts: null,
        failureReasonComment: null,
        completionLatitude: null,
        completionLongitude: null,
      },
    });

    const result = await applyWebhookEditEvent(TENANT, event, "TASK_HAS_BEEN_UPDATED");

    // Assertion 1 — safeParse passes (negative-test framing: if §3 not
    // applied, this fails first; outcome would be payload_validation_failed).
    // Assertion 2 — outcome.applied === true.
    expect(result.applied).toBe(true);

    // Assertion 3 — exactly one column moved (delivery_date). The 8 null
    // leaves do NOT contribute to columnsToUpdate because the extractor
    // coerces them to undefined and diffField short-circuits.
    if (result.applied) {
      expect(result.changedFieldCount).toBe(1);
    }

    // Assertion 4 + 5 — tasks.delivery_date moved + updated_at advanced.
    // Assertion 6 — none of the 8 nullable columns moved (load-bearing safety:
    // null-leniency must NOT cause Planner columns to be nulled out).
    const [task] = await withServiceRole("verify D29-NULL row state", async (tx) =>
      tx.execute(sqlTag`
        SELECT delivery_date, delivery_start_time, delivery_end_time, updated_at, created_at,
               recipient_name, signature, consignee_rating, consignee_comment,
               driver_comment, number_of_attempts,
               completion_latitude, completion_longitude
        FROM tasks WHERE id = ${TASK_NULL_TOL} LIMIT 1
      `),
    );
    const t = task as Record<string, unknown>;
    expect((t.delivery_date as string).slice(0, 10)).toBe("2026-05-19");
    const updatedAt = new Date(t.updated_at as string);
    const createdAt = new Date(t.created_at as string);
    expect(updatedAt.getTime()).toBeGreaterThan(createdAt.getTime());

    expect(t.recipient_name).toBe("Pre-Existing Recipient");
    expect(t.signature).toBe("data:base64,preexisting");
    expect(t.consignee_rating).toBe(4);
    expect(t.consignee_comment).toBe("Pre-existing rating");
    expect(t.driver_comment).toBe("Pre-existing driver note");
    expect(t.number_of_attempts).toBe(0);
    expect(Number(t.completion_latitude)).toBe(25.1);
    expect(Number(t.completion_longitude)).toBe(55.2);

    // Assertion 7 — audit row with single delivery_date changed_fields entry;
    // 8 null leaves do NOT appear (diffField short-circuited on undefined
    // before push, so no metadata pollution).
    const audits = await withServiceRole("verify D29-NULL audit shape", async (tx) =>
      tx.execute(sqlTag`
        SELECT metadata FROM audit_events
        WHERE event_type = 'task.edit_applied_via_webhook'
          AND tenant_id = ${TENANT}
          AND resource_id = ${TASK_NULL_TOL}
      `),
    );
    expect(audits).toHaveLength(1);
    const meta = (audits[0] as { metadata: Record<string, unknown> }).metadata;
    const changedFields = meta.changed_fields as readonly { field: string; previous: unknown; new: unknown }[];
    expect(changedFields).toHaveLength(1);
    expect(changedFields[0].field).toBe("delivery_date");
    expect(changedFields[0].new).toBe("2026-05-19");

    // Assertion 8 — webhook_events row preserved with verbatim raw payload
    // including the all-null deliveryInformation block (forensic discipline).
    const webhookRows = await withServiceRole("verify D29-NULL webhook_events preserved", async (tx) =>
      tx.execute(sqlTag`
        SELECT raw_payload FROM webhook_events
        WHERE tenant_id = ${TENANT}
          AND suitefleet_task_id = ${AWB_NULL_TOL}
          AND action = 'TASK_HAS_BEEN_UPDATED'
      `),
    );
    expect(webhookRows).toHaveLength(1);
    const raw = (webhookRows[0] as { raw_payload: Record<string, unknown> }).raw_payload;
    const di = raw.deliveryInformation as Record<string, unknown>;
    expect(di.recipientName).toBeNull();
    expect(di.signature).toBeNull();
    expect(di.consigneeRating).toBeNull();
    expect(di.completionLatitude).toBeNull();
    expect(di.completionLongitude).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // D29-NULL-DUP (plan #303 OQ-2) — negative-replay against the dedup gate.
  //
  // Confirms the null-tolerance widening did NOT route around the
  // webhook_events UNIQUE-constraint dedup. The all-null shape is the only
  // place this combination is exercised; mirrors test 7's pattern of
  // replaying the same (awb, occurredAt) tuple post-success.
  // ---------------------------------------------------------------------------

  it("D29-NULL-DUP — replaying the all-null fixture against the dedup gate returns reason='duplicate'", async () => {
    const occurredAt = "2026-05-09T16:00:00.000Z"; // same as D29-NULL
    const event = buildEditEvent(AWB_NULL_TOL, occurredAt, {
      deliveryDate: "2026-05-19",
      deliveryStartTime: "08:00:00",
      deliveryEndTime: "10:00:00",
      deliveryInformation: {
        recipientName: null,
        signature: null,
        consigneeRating: null,
        consigneeComment: null,
        driverComment: null,
        numberOfAttempts: null,
        failureReasonComment: null,
        completionLatitude: null,
        completionLongitude: null,
      },
    });

    const result = await applyWebhookEditEvent(TENANT, event, "TASK_HAS_BEEN_UPDATED");
    expect(result.applied).toBe(false);
    if (!result.applied) {
      expect(result.reason).toBe("duplicate");
    }
  });
});
