// tests/integration/webhook-status-embedded-delta-applied.spec.ts
// =============================================================================
// Day-31 / A1 — applyWebhookStatusEvent embedded-delta reconciliation.
//
// Pins the structural fix per plan #306 final lane shape: TASK_STATUS_UPDATED_TO_*
// status events must reconcile field deltas embedded at TOP LEVEL of the
// raw_payload (deliveryDate / deliveryStartTime / deliveryEndTime). Times
// arrive in UTC and are converted to Dubai-local via utcTimeToDubaiLocal.
// Address is OUT OF SCOPE (consignee-level per locked B1 ruling).
//
// Cases pinned:
//   I-interleaving — Late-change-rides-status-event sequence. Mirrors the
//     real MPL-38610276 shape: early TASK_HAS_BEEN_UPDATED edit event applies
//     a window edit, then a LATER TASK_STATUS_UPDATED_TO_* status event
//     carries a date edit that only appears post-fix. Asserts the row
//     converges to the LATE date. Named §3.6 #2 hard-stop surface — a
//     spec that only does "edit then deliver" would pass while the real
//     bug survives.
//
//   I-tz — Inbound TZ symmetric: status payload top-level deliveryStartTime
//     "06:00:00" (UTC) lands on the row as "10:00:00" (Dubai-local).
//     Confirms utcTimeToDubaiLocal applied. deliveryDate stays Dubai-local
//     (no shift).
//
//   I-wrap — Post-conversion wrap-inversion on a DELIVERED event with POD
//     photos (UTC 18:00-22:00 → Dubai 22:00-02:00 → end < start). The
//     §3.6 #2 Finding 2 revision: the event APPLIES — internal_status
//     flips to DELIVERED, pod_photos extract, ONLY the inverted time pair
//     is excluded from the write set. Audit changed_fields excludes the
//     time fields (Finding 1(b)).
//
//   I-skipped-embedded — §3.6 #2 Finding 1 load-bearing pin. Task seeded at
//     internal_status='SKIPPED' receives a status event carrying an embedded
//     deliveryDate delta. Asserts: delivery_date DID apply (embedded UPDATE
//     is unguarded); internal_status STAYED 'SKIPPED' (status UPDATE 2 is
//     SKIPPED-guarded as #305 §6.2 intended); audit changed_fields matches
//     the actual persisted write (delivery_date present, internal_status
//     absent — internal_status is tracked separately via previous_status /
//     new_status, never in changed_fields).
//
//   I-addr — address-bearing status payload (consignee.location.addressLine1)
//     does NOT mutate tasks.address_id. Locked B1 ruling — address is
//     consignee-level. The status handler must not introduce an address
//     write that the existing edit handler intentionally avoids.
//
// Named §3.6 #2 hard-stop surface: scheduled-window deltas MUST be read
// from raw_payload TOP LEVEL ONLY. Reading them from deliveryInformation.*
// (driver actual-completion timestamps) would pass a green test while
// writing the driver clock into the scheduled window. I-driver-info pins
// the negative case: deliveryInformation.deliveryStartTime present with a
// driver clock value MUST NOT overwrite the scheduled window.
//
// Per-run isolation: random RUN_ID prevents cross-run collisions; teardown
// is implicit via random suffix per memory/followup_audit_rule_cascade_conflict.md.
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { withServiceRole } from "../../src/shared/db";
import { applyWebhookStatusEvent } from "../../src/modules/integration/providers/suitefleet/apply-webhook-status-event";
import { applyWebhookEditEvent } from "../../src/modules/integration/providers/suitefleet/apply-webhook-edit-event";
import type { WebhookEvent } from "../../src/modules/integration/types";
import type { Uuid } from "../../src/shared/types";

const RUN_ID = randomUUID().slice(0, 8);
const TENANT = randomUUID() as Uuid;
const SLUG = `wsed-${RUN_ID}`;
const CONSIGNEE = randomUUID();

// One task per scenario — distinct AWBs so cross-test interference is impossible.
const AWB_INTERLEAVE = `WSED-${RUN_ID}-INTLV`;
const AWB_TZ = `WSED-${RUN_ID}-TZ`;
const AWB_WRAP = `WSED-${RUN_ID}-WRAP`;
const AWB_ADDR = `WSED-${RUN_ID}-ADDR`;
const AWB_DRIVER_INFO = `WSED-${RUN_ID}-DRVINFO`;
const AWB_SKIPPED = `WSED-${RUN_ID}-SKIPPED`;

const TASK_INTERLEAVE = randomUUID() as Uuid;
const TASK_TZ = randomUUID() as Uuid;
const TASK_WRAP = randomUUID() as Uuid;
const TASK_ADDR = randomUUID() as Uuid;
const TASK_DRIVER_INFO = randomUUID() as Uuid;
const TASK_SKIPPED = randomUUID() as Uuid;

const ADDR_ORIG = randomUUID();

const EXT_ID_BASE = parseInt(RUN_ID, 16);
const EXT_ID_INTERLEAVE = String(EXT_ID_BASE + 1);
const EXT_ID_TZ = String(EXT_ID_BASE + 2);
const EXT_ID_WRAP = String(EXT_ID_BASE + 3);
const EXT_ID_ADDR = String(EXT_ID_BASE + 4);
const EXT_ID_DRIVER_INFO = String(EXT_ID_BASE + 5);
const EXT_ID_SKIPPED = String(EXT_ID_BASE + 6);

function buildStatusEvent(
  awb: string,
  occurredAt: string,
  raw: Record<string, unknown>,
): WebhookEvent {
  return {
    kind: "TASK_STATUS_CHANGED",
    externalTaskId: awb,
    occurredAt,
    idempotencyKey: `key-${awb}-${occurredAt}-${randomUUID().slice(0, 6)}`,
    raw: { awb, ...raw },
  };
}

function buildEditEvent(
  awb: string,
  occurredAt: string,
  raw: Record<string, unknown>,
): WebhookEvent {
  return {
    kind: "TASK_STATUS_CHANGED",
    externalTaskId: awb,
    occurredAt,
    idempotencyKey: `key-${awb}-${occurredAt}-${randomUUID().slice(0, 6)}`,
    raw: { awb, action: "TASK_HAS_BEEN_UPDATED", eventTimestamp: occurredAt, ...raw },
  };
}

describe("Day-31 / A1 — applyWebhookStatusEvent embedded-delta reconciliation (real Postgres)", () => {
  beforeAll(async () => {
    await withServiceRole("Day-31 A1 status embedded-delta setup", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, status) VALUES
          (${TENANT}, ${SLUG}, 'A1 Embedded Delta Test', 'active')
      `);
      await tx.execute(sqlTag`
        INSERT INTO consignees (id, tenant_id, name, phone, address_line, emirate_or_region, district)
        VALUES
          (${CONSIGNEE}, ${TENANT}, 'A1 Test Consignee', ${`+97150ed${RUN_ID}`},
           'Test Building', 'Dubai', 'Test District')
      `);
      await tx.execute(sqlTag`
        INSERT INTO addresses (id, tenant_id, consignee_id, label, line, district, emirate, is_primary)
        VALUES (${ADDR_ORIG}, ${TENANT}, ${CONSIGNEE}, 'home', 'Tower 1', 'Marina', 'Dubai', true)
      `);
      // Per-task fixtures. TASK_SKIPPED is intentionally seeded at
      // internal_status='SKIPPED' to exercise the post-revision contract:
      // embedded scheduled-window deltas apply UNGUARDED while the
      // operator-set SKIPPED status is preserved by the status-UPDATE
      // guard. All other tasks start at 'CREATED' to keep the guard
      // unfired in their scenarios.
      await tx.execute(sqlTag`
        INSERT INTO tasks (
          id, tenant_id, consignee_id, customer_order_number,
          external_id, external_tracking_number, address_id,
          internal_status, delivery_date, delivery_start_time, delivery_end_time,
          created_via
        ) VALUES
          (${TASK_INTERLEAVE}, ${TENANT}, ${CONSIGNEE}, ${`WSED-INTLV-${RUN_ID}`},
           ${EXT_ID_INTERLEAVE}, ${AWB_INTERLEAVE}, ${ADDR_ORIG},
           'CREATED', '2026-05-20', '08:00:00', '10:00:00', 'manual_admin'),
          (${TASK_TZ}, ${TENANT}, ${CONSIGNEE}, ${`WSED-TZ-${RUN_ID}`},
           ${EXT_ID_TZ}, ${AWB_TZ}, ${ADDR_ORIG},
           'CREATED', '2026-05-20', '08:00:00', '10:00:00', 'manual_admin'),
          (${TASK_WRAP}, ${TENANT}, ${CONSIGNEE}, ${`WSED-WRAP-${RUN_ID}`},
           ${EXT_ID_WRAP}, ${AWB_WRAP}, ${ADDR_ORIG},
           'CREATED', '2026-05-20', '08:00:00', '10:00:00', 'manual_admin'),
          (${TASK_ADDR}, ${TENANT}, ${CONSIGNEE}, ${`WSED-ADDR-${RUN_ID}`},
           ${EXT_ID_ADDR}, ${AWB_ADDR}, ${ADDR_ORIG},
           'CREATED', '2026-05-20', '08:00:00', '10:00:00', 'manual_admin'),
          (${TASK_DRIVER_INFO}, ${TENANT}, ${CONSIGNEE}, ${`WSED-DRVINFO-${RUN_ID}`},
           ${EXT_ID_DRIVER_INFO}, ${AWB_DRIVER_INFO}, ${ADDR_ORIG},
           'CREATED', '2026-05-20', '08:00:00', '10:00:00', 'manual_admin'),
          (${TASK_SKIPPED}, ${TENANT}, ${CONSIGNEE}, ${`WSED-SKIPPED-${RUN_ID}`},
           ${EXT_ID_SKIPPED}, ${AWB_SKIPPED}, ${ADDR_ORIG},
           'SKIPPED', '2026-05-20', '08:00:00', '10:00:00', 'manual_admin')
      `);
    });
  });

  // ---------------------------------------------------------------------------
  // I-interleaving — late-change-rides-status-event sequence
  //
  // Mirrors the real MPL-38610276 shape: early TASK_HAS_BEEN_UPDATED edit
  // event applies a WINDOW edit (start/end time), then a LATER
  // TASK_STATUS_UPDATED_TO_* status event carries a DATE edit that ONLY
  // applies post-fix. Asserts the row converges to BOTH the early-edited
  // window AND the late-edited date.
  //
  // Pre-fix bug shape this spec pins: only the early edit applied (window
  // moved), the date stayed at 2026-05-20. The naive "edit then deliver"
  // spec would have shown the date stale AND looked like clean
  // confirmation while the bug survived.
  // ---------------------------------------------------------------------------

  it("I-interleaving — early edit applies window; late status event applies the date delta; row converges to BOTH", async () => {
    // Step 1: early TASK_HAS_BEEN_UPDATED edit event — window moves
    // 08:00-10:00 → 13:00-15:00. Uses the EXISTING edit handler path
    // (unchanged by A1).
    const editEvent = buildEditEvent(AWB_INTERLEAVE, "2026-05-19T08:20:36.000Z", {
      deliveryStartTime: "09:00:00", // UTC; current existing edit handler
                                      // writes verbatim into Dubai-local time
                                      // column (latent inbound-TZ bug per §2.5,
                                      // out of scope this PR). Choose values
                                      // that won't collide with the status-
                                      // path test's converted values below.
      deliveryEndTime: "11:00:00",
    });
    const editResult = await applyWebhookEditEvent(
      TENANT,
      editEvent,
      "TASK_HAS_BEEN_UPDATED",
    );
    expect(editResult.applied).toBe(true);

    // Confirm the early edit landed on the window.
    const [postEdit] = await withServiceRole("I-interleaving postEdit", async (tx) =>
      tx.execute(sqlTag`
        SELECT delivery_date::text AS delivery_date,
               delivery_start_time::text AS delivery_start_time,
               delivery_end_time::text AS delivery_end_time
        FROM tasks WHERE id = ${TASK_INTERLEAVE} LIMIT 1
      `),
    );
    const editedRow = postEdit as {
      delivery_date: string;
      delivery_start_time: string;
      delivery_end_time: string;
    };
    expect(editedRow.delivery_start_time).toBe("09:00:00");
    expect(editedRow.delivery_end_time).toBe("11:00:00");
    // date NOT yet changed.
    expect(editedRow.delivery_date).toBe("2026-05-20");

    // Step 2: late TASK_STATUS_UPDATED_TO_OUT_FOR_DELIVERY status event
    // carrying a DATE edit (2026-05-20 → 2026-05-19) embedded at top
    // level. This is the post-fix-only delta — the structural fix to
    // applyWebhookStatusEvent must apply it now.
    const statusEvent = buildStatusEvent(AWB_INTERLEAVE, "2026-05-19T12:23:35.000Z", {
      action: "TASK_STATUS_UPDATED_TO_OUT_FOR_DELIVERY",
      eventTimestamp: "2026-05-19T12:23:35.000Z",
      deliveryDate: "2026-05-19",
    });
    const statusResult = await applyWebhookStatusEvent(
      TENANT,
      statusEvent,
      "TASK_STATUS_UPDATED_TO_OUT_FOR_DELIVERY",
    );
    expect(statusResult.applied).toBe(true);

    // Step 3: convergence assertion — row carries the late date AND
    // preserves the early window edit.
    const [convergedRow] = await withServiceRole("I-interleaving converged", async (tx) =>
      tx.execute(sqlTag`
        SELECT internal_status,
               delivery_date::text AS delivery_date,
               delivery_start_time::text AS delivery_start_time,
               delivery_end_time::text AS delivery_end_time
        FROM tasks WHERE id = ${TASK_INTERLEAVE} LIMIT 1
      `),
    );
    const conv = convergedRow as {
      internal_status: string;
      delivery_date: string;
      delivery_start_time: string;
      delivery_end_time: string;
    };
    expect(conv.internal_status).toBe("IN_TRANSIT");
    expect(conv.delivery_date).toBe("2026-05-19");
    // window preserved from the early edit (no further window edit in
    // step 2 → no UPDATE on those columns).
    expect(conv.delivery_start_time).toBe("09:00:00");
    expect(conv.delivery_end_time).toBe("11:00:00");

    // Audit metadata captures the embedded delta.
    const auditRows = await withServiceRole("I-interleaving audit", async (tx) =>
      tx.execute(sqlTag`
        SELECT metadata
        FROM audit_events
        WHERE event_type = 'task.status_changed_via_webhook'
          AND tenant_id = ${TENANT}
          AND resource_id = ${TASK_INTERLEAVE}
        ORDER BY occurred_at DESC
        LIMIT 1
      `),
    );
    const meta = (auditRows[0] as { metadata: Record<string, unknown> }).metadata;
    expect(meta.changed_fields).toEqual([
      { field: "delivery_date", previous: "2026-05-20", new: "2026-05-19" },
    ]);
  });

  // ---------------------------------------------------------------------------
  // I-tz — Inbound TZ symmetric
  //
  // Status payload top-level deliveryStartTime "06:00:00" (UTC) → row
  // delivery_start_time "10:00:00" (Dubai-local). utcTimeToDubaiLocal
  // applied. deliveryDate stays Dubai-local (no shift).
  // ---------------------------------------------------------------------------

  it("I-tz — inbound UTC times convert to Dubai-local via utcTimeToDubaiLocal", async () => {
    const event = buildStatusEvent(AWB_TZ, "2026-05-19T06:30:00.000Z", {
      action: "TASK_STATUS_UPDATED_TO_PICKED_UP",
      eventTimestamp: "2026-05-19T06:30:00.000Z",
      deliveryDate: "2026-05-19",
      deliveryStartTime: "06:00:00", // UTC → Dubai 10:00:00
      deliveryEndTime: "08:00:00", //   UTC → Dubai 12:00:00
    });
    const result = await applyWebhookStatusEvent(
      TENANT,
      event,
      "TASK_STATUS_UPDATED_TO_PICKED_UP",
    );
    expect(result.applied).toBe(true);

    const [row] = await withServiceRole("I-tz verify", async (tx) =>
      tx.execute(sqlTag`
        SELECT delivery_date::text AS delivery_date,
               delivery_start_time::text AS delivery_start_time,
               delivery_end_time::text AS delivery_end_time
        FROM tasks WHERE id = ${TASK_TZ} LIMIT 1
      `),
    );
    const r = row as {
      delivery_date: string;
      delivery_start_time: string;
      delivery_end_time: string;
    };
    // delivery_date stays Dubai-local — no TZ shift on a date column.
    expect(r.delivery_date).toBe("2026-05-19");
    // delivery_start/end_time = wire UTC + 4h = Dubai-local.
    expect(r.delivery_start_time).toBe("10:00:00");
    expect(r.delivery_end_time).toBe("12:00:00");
  });

  // ---------------------------------------------------------------------------
  // I-wrap — §3.6 #2 Finding 2 revision: wrap-inverted time pair is
  // EXCLUDED from the write set, but the rest of the event APPLIES.
  //
  // Pre-revision shape (short-circuit before SELECT/UPDATE) dropped the
  // entire event including DELIVERED status + POD photos — over-broad
  // blast radius for a rare malformed-time case. Post-revision: the
  // wrap is a structured log signal; internal_status flips, pod_photos
  // extract, deliveryDate (if any) writes, and ONLY the inverted
  // start/end time PAIR is suppressed. Audit changed_fields reflects
  // the actual persisted write set (Finding 1(b)) — the time fields
  // are absent.
  //
  // Uses TASK_STATUS_UPDATED_TO_DELIVERED + photos to pin Love's
  // explicit directive: status + POD must NOT be dropped on wrap.
  // ---------------------------------------------------------------------------

  it("I-wrap — wrap-inverted time pair excluded; DELIVERED + POD apply; times unchanged; audit excludes time fields", async () => {
    const event = buildStatusEvent(AWB_WRAP, "2026-05-19T18:00:00.000Z", {
      action: "TASK_STATUS_UPDATED_TO_DELIVERED",
      eventTimestamp: "2026-05-19T18:00:00.000Z",
      deliveryStartTime: "18:00:00", // UTC → Dubai 22:00:00
      deliveryEndTime: "22:00:00", //   UTC → Dubai 02:00:00 (next day clock; wrap)
      deliveryInformation: {
        recipientName: "Test Recipient",
        photos: ["https://example.com/pod-wrap.jpg"],
      },
    });
    const result = await applyWebhookStatusEvent(
      TENANT,
      event,
      "TASK_STATUS_UPDATED_TO_DELIVERED",
    );
    expect(result.applied).toBe(true);

    // webhook_events row preserved (forensic — unchanged from pre-revision).
    const [whRow] = await withServiceRole("I-wrap webhook_events preserved", async (tx) =>
      tx.execute(sqlTag`
        SELECT action FROM webhook_events
        WHERE suitefleet_task_id = ${AWB_WRAP}
        ORDER BY event_timestamp DESC LIMIT 1
      `),
    );
    expect((whRow as { action: string }).action).toBe(
      "TASK_STATUS_UPDATED_TO_DELIVERED",
    );

    // Status flipped to DELIVERED; pod_photos extracted; time PAIR
    // unchanged at seeded values (excluded from write set, not written).
    const [taskRow] = await withServiceRole("I-wrap task state", async (tx) =>
      tx.execute(sqlTag`
        SELECT internal_status,
               delivery_start_time::text AS delivery_start_time,
               delivery_end_time::text AS delivery_end_time,
               pod_photos
        FROM tasks WHERE id = ${TASK_WRAP} LIMIT 1
      `),
    );
    const t = taskRow as {
      internal_status: string;
      delivery_start_time: string;
      delivery_end_time: string;
      pod_photos: unknown;
    };
    expect(t.internal_status).toBe("DELIVERED");
    expect(t.pod_photos).toEqual(["https://example.com/pod-wrap.jpg"]);
    expect(t.delivery_start_time).toBe("08:00:00"); // seeded value preserved
    expect(t.delivery_end_time).toBe("10:00:00"); // seeded value preserved

    // Audit changed_fields excludes the inverted time pair — the event
    // had no top-level deliveryDate, so changed_fields is empty.
    const auditRows = await withServiceRole("I-wrap audit", async (tx) =>
      tx.execute(sqlTag`
        SELECT metadata
        FROM audit_events
        WHERE event_type = 'task.status_changed_via_webhook'
          AND tenant_id = ${TENANT}
          AND resource_id = ${TASK_WRAP}
        ORDER BY occurred_at DESC
        LIMIT 1
      `),
    );
    const meta = (auditRows[0] as { metadata: Record<string, unknown> }).metadata;
    expect(meta.changed_fields).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // I-addr — address-bearing status payload does NOT write tasks.address_id
  //
  // Address is consignee-level (locked B1 ruling). The status handler must
  // not introduce an address write that the existing edit handler
  // intentionally avoids (two enforcement layers in apply-webhook-edit-event.ts).
  // ---------------------------------------------------------------------------

  it("I-addr — address-bearing status payload does NOT mutate tasks.address_id", async () => {
    const newAddressId = randomUUID();
    // Seed a candidate alternative address — not used by the fix, but
    // present in the DB so the test isn't testing "field-validation
    // rejected a nonexistent FK target." Confirms the absence of write
    // even when a valid alternative exists.
    await withServiceRole("I-addr seed alt address", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO addresses (id, tenant_id, consignee_id, label, line, district, emirate, is_primary)
        VALUES (${newAddressId}, ${TENANT}, ${CONSIGNEE}, 'office', 'Tower 7', 'Downtown', 'Dubai', false)
      `);
    });

    const event = buildStatusEvent(AWB_ADDR, "2026-05-19T07:30:00.000Z", {
      action: "TASK_STATUS_UPDATED_TO_PICKED_UP",
      eventTimestamp: "2026-05-19T07:30:00.000Z",
      // Embedded consignee.location change (SF mints a new consignee
      // on address edit — but Planner address is consignee-level, not
      // task-level, per locked B1).
      consignee: {
        id: 99999,
        name: "Updated Consignee",
        location: {
          addressLine1: "North Park",
          district: "Downtown",
          city: "Dubai",
          countryCode: "AE",
        },
      },
    });
    const result = await applyWebhookStatusEvent(
      TENANT,
      event,
      "TASK_STATUS_UPDATED_TO_PICKED_UP",
    );
    expect(result.applied).toBe(true); // status apply succeeds

    const [row] = await withServiceRole("I-addr verify", async (tx) =>
      tx.execute(sqlTag`
        SELECT address_id FROM tasks WHERE id = ${TASK_ADDR} LIMIT 1
      `),
    );
    // address_id UNCHANGED — still the original seed address.
    expect((row as { address_id: string }).address_id).toBe(ADDR_ORIG);
  });

  // ---------------------------------------------------------------------------
  // I-driver-info — NAMED §3.6 #2 hard-stop surface (negative case)
  //
  // deliveryInformation.deliveryStartTime / deliveryInformation.deliveryEndTime
  // are DRIVER ACTUAL-COMPLETION timestamps (per plan #306 refinement §4 —
  // e.g. 16:23/16:24 = when the driver actually started/finished). A fix
  // that reads from this path would write the driver clock into the
  // scheduled window. The schema admits ONLY top-level fields.
  //
  // This spec sends a payload with ONLY driver-completion clock values in
  // deliveryInformation (no top-level scheduled fields) and asserts the
  // scheduled window is UNCHANGED.
  // ---------------------------------------------------------------------------

  it("I-driver-info — deliveryInformation.* values do NOT overwrite the scheduled window (top-level-only contract)", async () => {
    const event = buildStatusEvent(AWB_DRIVER_INFO, "2026-05-19T12:24:00.000Z", {
      action: "TASK_STATUS_UPDATED_TO_DELIVERED",
      eventTimestamp: "2026-05-19T12:24:00.000Z",
      // No top-level deliveryDate / Start / End — only nested driver info.
      deliveryInformation: {
        // These are driver actual-completion timestamps. They MUST NOT
        // be read as scheduled-window deltas.
        deliveryDate: "2026-05-19",
        deliveryStartTime: "12:23:00",
        deliveryEndTime: "12:24:00",
        recipientName: "Test Recipient",
        photos: ["https://example.com/pod-A.jpg"],
      },
    });
    const result = await applyWebhookStatusEvent(
      TENANT,
      event,
      "TASK_STATUS_UPDATED_TO_DELIVERED",
    );
    expect(result.applied).toBe(true); // status flips to DELIVERED

    const [row] = await withServiceRole("I-driver-info verify", async (tx) =>
      tx.execute(sqlTag`
        SELECT internal_status,
               delivery_date::text AS delivery_date,
               delivery_start_time::text AS delivery_start_time,
               delivery_end_time::text AS delivery_end_time,
               pod_photos
        FROM tasks WHERE id = ${TASK_DRIVER_INFO} LIMIT 1
      `),
    );
    const r = row as {
      internal_status: string;
      delivery_date: string;
      delivery_start_time: string;
      delivery_end_time: string;
      pod_photos: unknown;
    };
    expect(r.internal_status).toBe("DELIVERED");
    // POD photos extracted (deliveryInformation.photos IS the legitimate
    // POD source — this read path is unchanged and orthogonal).
    expect(r.pod_photos).toEqual(["https://example.com/pod-A.jpg"]);
    // Scheduled window UNCHANGED — driver actual-completion clock
    // values from deliveryInformation MUST NOT bleed in.
    expect(r.delivery_date).toBe("2026-05-20");
    expect(r.delivery_start_time).toBe("08:00:00");
    expect(r.delivery_end_time).toBe("10:00:00");
  });

  // ---------------------------------------------------------------------------
  // I-skipped-embedded — §3.6 #2 Finding 1 load-bearing pin
  //
  // Task seeded at internal_status='SKIPPED' (operator decision) receives a
  // status event carrying an embedded deliveryDate delta. Required post-
  // revision behavior:
  //   - delivery_date applies (embedded UPDATE is unguarded — a schedule
  //     edit on a SKIPPED task is still a real schedule fact)
  //   - internal_status STAYS 'SKIPPED' (status UPDATE 2 is SKIPPED-
  //     guarded per #305 §6.2 — operator intent wins over webhook ack)
  //   - audit changed_fields = [{ delivery_date }] EXACTLY (driven from
  //     UPDATE 1 RETURNING delta — reflects actual persisted write, not
  //     pre-write intent). internal_status is NEVER in changed_fields by
  //     contract (it's tracked separately via previous_status / new_status).
  // ---------------------------------------------------------------------------

  it("I-skipped-embedded — SKIPPED task: embedded deliveryDate delta applies, internal_status preserved, audit changed_fields matches actual writes", async () => {
    const event = buildStatusEvent(AWB_SKIPPED, "2026-05-19T07:00:00.000Z", {
      action: "TASK_STATUS_UPDATED_TO_OUT_FOR_DELIVERY",
      eventTimestamp: "2026-05-19T07:00:00.000Z",
      deliveryDate: "2026-05-21",
    });
    const result = await applyWebhookStatusEvent(
      TENANT,
      event,
      "TASK_STATUS_UPDATED_TO_OUT_FOR_DELIVERY",
    );
    expect(result.applied).toBe(true);

    const [row] = await withServiceRole("I-skipped-embedded verify", async (tx) =>
      tx.execute(sqlTag`
        SELECT internal_status,
               delivery_date::text AS delivery_date,
               delivery_start_time::text AS delivery_start_time,
               delivery_end_time::text AS delivery_end_time
        FROM tasks WHERE id = ${TASK_SKIPPED} LIMIT 1
      `),
    );
    const r = row as {
      internal_status: string;
      delivery_date: string;
      delivery_start_time: string;
      delivery_end_time: string;
    };
    // Embedded delta APPLIED — schedule fact persists on a SKIPPED task.
    expect(r.delivery_date).toBe("2026-05-21");
    // SKIPPED status PRESERVED — operator intent wins, status UPDATE 2 guard fires.
    expect(r.internal_status).toBe("SKIPPED");
    // Untouched columns confirm no collateral writes.
    expect(r.delivery_start_time).toBe("08:00:00");
    expect(r.delivery_end_time).toBe("10:00:00");

    // Audit changed_fields exactly mirrors the actual persisted write:
    // delivery_date is present, internal_status is absent (it didn't
    // move, AND it's tracked separately in any case).
    const auditRows = await withServiceRole("I-skipped-embedded audit", async (tx) =>
      tx.execute(sqlTag`
        SELECT metadata
        FROM audit_events
        WHERE event_type = 'task.status_changed_via_webhook'
          AND tenant_id = ${TENANT}
          AND resource_id = ${TASK_SKIPPED}
        ORDER BY occurred_at DESC
        LIMIT 1
      `),
    );
    const meta = (auditRows[0] as { metadata: Record<string, unknown> }).metadata;
    expect(meta.changed_fields).toEqual([
      { field: "delivery_date", previous: "2026-05-20", new: "2026-05-21" },
    ]);
  });
});
