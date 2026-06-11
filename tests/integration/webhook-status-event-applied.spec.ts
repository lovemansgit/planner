// tests/integration/webhook-status-event-applied.spec.ts
// =============================================================================
// Day-18 / A2 Layer 2 — applyWebhookStatusEvent integration coverage.
//
// Pins the real-Postgres behaviour of the webhook status-event applier:
//   1. Happy path — webhook_events row written + tasks.internal_status
//      flipped + audit_events row emitted.
//   2. Idempotency — re-invoking the same payload returns
//      { applied: false, reason: "duplicate" } and does NOT double-write.
//   3. Task-not-found — payload's AWB doesn't match any tasks.external_id
//      → returns { applied: false, reason: "task_not_found" }; the
//      webhook_events row is still preserved (forensic surface) and
//      no audit emit fires.
//   4. Non-lifecycle action — TASK_HAS_BEEN_UPDATED skipped silently
//      (Layer 3 handles it).
//   5. DELIVERED branch — tasks.pod_photos populated + a second audit
//      event (task.pod_received_via_webhook) fires.
//
// Per-run isolation: random RUN_ID slug suffix prevents cross-run
// collisions; teardown is implicit via random suffix per
// memory/followup_audit_rule_cascade_conflict.md (audit_events_no_delete
// RULE blocks DELETE cascade).
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { withServiceRole } from "../../src/shared/db";
import { applyWebhookStatusEvent } from "../../src/modules/integration/providers/suitefleet/apply-webhook-status-event";
import type { WebhookEvent } from "../../src/modules/integration/types";
import type { Uuid } from "../../src/shared/types";

const RUN_ID = randomUUID().slice(0, 8);
const TENANT = randomUUID() as Uuid;
const SLUG = `wse-${RUN_ID}`;
const CONSIGNEE = randomUUID();

// One task per scenario — distinct AWBs so cross-test interference
// is impossible.
const AWB_PICKED_UP = `WSE-${RUN_ID}-PICKED_UP`;
const AWB_DELIVERED = `WSE-${RUN_ID}-DELIVERED`;
const AWB_NOT_FOUND = `WSE-${RUN_ID}-MISSING`;
const AWB_LOOKUP_REGRESSION = `WSE-${RUN_ID}-LOOKUPREG`;

const TASK_PICKED_UP = randomUUID() as Uuid;
const TASK_DELIVERED = randomUUID() as Uuid;
const TASK_LOOKUP_REGRESSION = randomUUID() as Uuid;

// Numeric placeholders for tasks.external_id — production stores SF numeric
// IDs here while AWB strings live on tasks.external_tracking_number. Tests
// mirror the production data layout so the webhook handler's
// external_tracking_number lookup matches the parser-extracted AWB.
const EXT_ID_BASE = parseInt(RUN_ID, 16);
const EXT_ID_PICKED_UP = String(EXT_ID_BASE + 1);
const EXT_ID_DELIVERED = String(EXT_ID_BASE + 2);
const EXT_ID_LOOKUP_REGRESSION = String(EXT_ID_BASE + 3);

function buildEvent(awb: string, occurredAt: string, raw: Record<string, unknown>): WebhookEvent {
  return {
    kind: "TASK_STATUS_CHANGED",
    externalTaskId: awb,
    occurredAt,
    idempotencyKey: `key-${awb}-${occurredAt}`,
    raw: { awb, ...raw },
  };
}

describe("Day-18 / A2 Layer 2 — applyWebhookStatusEvent (real Postgres)", () => {
  beforeAll(async () => {
    await withServiceRole("Day-18 A2 Layer-2 integration setup", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, status) VALUES
          (${TENANT}, ${SLUG}, 'WSE A2 L2 Test', 'active')
      `);
      await tx.execute(sqlTag`
        INSERT INTO consignees (id, tenant_id, name, phone, address_line, emirate_or_region, district)
        VALUES
          (${CONSIGNEE}, ${TENANT}, 'WSE Test Consignee', ${`+97150${RUN_ID}`},
           'Test Building', 'Dubai', 'Test District')
      `);
      await tx.execute(sqlTag`
        INSERT INTO tasks (
          id, tenant_id, consignee_id, customer_order_number,
          external_id, external_tracking_number,
          internal_status, delivery_date, delivery_start_time, delivery_end_time,
          created_via
        ) VALUES
          (${TASK_PICKED_UP}, ${TENANT}, ${CONSIGNEE}, ${`WSE-PICKED-${RUN_ID}`},
           ${EXT_ID_PICKED_UP}, ${AWB_PICKED_UP},
           'CREATED', '2026-05-09', '08:00', '10:00',
           'manual_admin'),
          (${TASK_DELIVERED}, ${TENANT}, ${CONSIGNEE}, ${`WSE-DELIV-${RUN_ID}`},
           ${EXT_ID_DELIVERED}, ${AWB_DELIVERED},
           'IN_TRANSIT', '2026-05-09', '08:00', '10:00',
           'manual_admin'),
          (${TASK_LOOKUP_REGRESSION}, ${TENANT}, ${CONSIGNEE}, ${`WSE-LOOKUP-${RUN_ID}`},
           ${EXT_ID_LOOKUP_REGRESSION}, ${AWB_LOOKUP_REGRESSION},
           'CREATED', '2026-05-09', '08:00', '10:00',
           'manual_admin')
      `);
    });
  });

  // ---------------------------------------------------------------------------
  // 1. Happy path — PICKED_UP → IN_TRANSIT
  // ---------------------------------------------------------------------------

  it("happy path — PICKED_UP event flips status to IN_TRANSIT, writes webhook_events, emits audit", async () => {
    const occurredAt = "2026-05-09T08:30:00.000Z";
    const event = buildEvent(AWB_PICKED_UP, occurredAt, {
      action: "TASK_STATUS_UPDATED_TO_PICKED_UP",
      eventTimestamp: occurredAt,
    });

    const result = await applyWebhookStatusEvent(
      TENANT,
      event,
      "TASK_STATUS_UPDATED_TO_PICKED_UP",
    );

    expect(result.applied).toBe(true);
    if (result.applied) {
      expect(result.taskId).toBe(TASK_PICKED_UP);
      expect(result.newStatus).toBe("IN_TRANSIT");
    }

    // Verify webhook_events row.
    const [whEvent] = await withServiceRole("verify webhook_events row", async (tx) =>
      tx.execute(sqlTag`
        SELECT suitefleet_task_id, action, event_timestamp
        FROM webhook_events
        WHERE suitefleet_task_id = ${AWB_PICKED_UP}
        LIMIT 1
      `),
    );
    expect(whEvent).toBeDefined();
    expect((whEvent as { suitefleet_task_id: string }).suitefleet_task_id).toBe(AWB_PICKED_UP);
    expect((whEvent as { action: string }).action).toBe("TASK_STATUS_UPDATED_TO_PICKED_UP");

    // Verify task row.
    const [task] = await withServiceRole("verify task status flip", async (tx) =>
      tx.execute(sqlTag`SELECT internal_status FROM tasks WHERE id = ${TASK_PICKED_UP} LIMIT 1`),
    );
    expect((task as { internal_status: string }).internal_status).toBe("IN_TRANSIT");

    // Verify audit event.
    const [audit] = await withServiceRole("verify audit emit", async (tx) =>
      tx.execute(sqlTag`
        SELECT event_type, metadata
        FROM audit_events
        WHERE event_type = 'task.status_changed_via_webhook'
          AND tenant_id = ${TENANT}
          AND resource_id = ${TASK_PICKED_UP}
        ORDER BY occurred_at DESC
        LIMIT 1
      `),
    );
    expect((audit as { event_type: string }).event_type).toBe("task.status_changed_via_webhook");
    const meta = (audit as { metadata: Record<string, unknown> }).metadata;
    expect(meta.previous_status).toBe("CREATED");
    expect(meta.new_status).toBe("IN_TRANSIT");
    expect(meta.suitefleet_task_id).toBe(AWB_PICKED_UP);
  });

  // ---------------------------------------------------------------------------
  // 2. Idempotency — duplicate replay
  // ---------------------------------------------------------------------------

  it("duplicate event returns reason='duplicate', no double-write to webhook_events or audit", async () => {
    const occurredAt = "2026-05-09T08:30:00.000Z";
    const event = buildEvent(AWB_PICKED_UP, occurredAt, {
      action: "TASK_STATUS_UPDATED_TO_PICKED_UP",
      eventTimestamp: occurredAt,
    });

    // Capture pre-replay counts.
    const [{ count: preWh }] = await withServiceRole("count webhook_events pre", async (tx) =>
      tx.execute(sqlTag`SELECT COUNT(*)::int AS count FROM webhook_events WHERE suitefleet_task_id = ${AWB_PICKED_UP}`),
    ) as readonly { count: number }[];
    const [{ count: preAudit }] = await withServiceRole("count audit pre", async (tx) =>
      tx.execute(sqlTag`
        SELECT COUNT(*)::int AS count FROM audit_events
        WHERE event_type = 'task.status_changed_via_webhook'
          AND tenant_id = ${TENANT}
          AND resource_id = ${TASK_PICKED_UP}
      `),
    ) as readonly { count: number }[];

    const result = await applyWebhookStatusEvent(
      TENANT,
      event,
      "TASK_STATUS_UPDATED_TO_PICKED_UP",
    );
    expect(result.applied).toBe(false);
    if (!result.applied) {
      expect(result.reason).toBe("duplicate");
    }

    const [{ count: postWh }] = await withServiceRole("count webhook_events post", async (tx) =>
      tx.execute(sqlTag`SELECT COUNT(*)::int AS count FROM webhook_events WHERE suitefleet_task_id = ${AWB_PICKED_UP}`),
    ) as readonly { count: number }[];
    const [{ count: postAudit }] = await withServiceRole("count audit post", async (tx) =>
      tx.execute(sqlTag`
        SELECT COUNT(*)::int AS count FROM audit_events
        WHERE event_type = 'task.status_changed_via_webhook'
          AND tenant_id = ${TENANT}
          AND resource_id = ${TASK_PICKED_UP}
      `),
    ) as readonly { count: number }[];

    expect(postWh).toBe(preWh);
    expect(postAudit).toBe(preAudit);
  });

  // ---------------------------------------------------------------------------
  // 3. Task-not-found
  // ---------------------------------------------------------------------------

  it("returns task_not_found when AWB doesn't match any tasks.external_id; webhook_events row still written", async () => {
    const occurredAt = "2026-05-09T09:00:00.000Z";
    const event = buildEvent(AWB_NOT_FOUND, occurredAt, {
      action: "TASK_STATUS_UPDATED_TO_DELIVERED",
      eventTimestamp: occurredAt,
    });

    const result = await applyWebhookStatusEvent(TENANT, event, "TASK_STATUS_UPDATED_TO_DELIVERED");
    expect(result.applied).toBe(false);
    if (!result.applied) {
      expect(result.reason).toBe("task_not_found");
    }

    // webhook_events row IS written (forensic preservation).
    const [whEvent] = await withServiceRole("verify forensic webhook_events row", async (tx) =>
      tx.execute(sqlTag`
        SELECT suitefleet_task_id FROM webhook_events
        WHERE suitefleet_task_id = ${AWB_NOT_FOUND}
        LIMIT 1
      `),
    );
    expect(whEvent).toBeDefined();

    // No audit event for this AWB.
    const audits = await withServiceRole("verify no audit for missing task", async (tx) =>
      tx.execute(sqlTag`
        SELECT id FROM audit_events
        WHERE event_type = 'task.status_changed_via_webhook'
          AND metadata->>'suitefleet_task_id' = ${AWB_NOT_FOUND}
      `),
    );
    expect(audits).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // 4. Non-lifecycle action skip
  // ---------------------------------------------------------------------------

  it("non-lifecycle TASK_HAS_BEEN_UPDATED returns non_lifecycle_or_unknown; no DB writes", async () => {
    const occurredAt = "2026-05-09T09:30:00.000Z";
    const event = buildEvent(AWB_PICKED_UP, occurredAt, {
      action: "TASK_HAS_BEEN_UPDATED",
      eventTimestamp: occurredAt,
    });

    const result = await applyWebhookStatusEvent(TENANT, event, "TASK_HAS_BEEN_UPDATED");
    expect(result.applied).toBe(false);
    if (!result.applied) {
      expect(result.reason).toBe("non_lifecycle_or_unknown");
    }

    // No webhook_events row for this exact tuple (different timestamp from
    // the happy-path test).
    const rows = await withServiceRole("verify no wh row for non-lifecycle", async (tx) =>
      tx.execute(sqlTag`
        SELECT id FROM webhook_events
        WHERE suitefleet_task_id = ${AWB_PICKED_UP}
          AND action = 'TASK_HAS_BEEN_UPDATED'
          AND event_timestamp = ${occurredAt}
      `),
    );
    expect(rows).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // 5. DELIVERED branch — POD photos + second audit event
  // ---------------------------------------------------------------------------

  it("DELIVERED event writes pod_photos + emits both task.status_changed_via_webhook AND task.pod_received_via_webhook", async () => {
    const occurredAt = "2026-05-09T10:00:00.000Z";
    const photos = [
      "https://test-fixture.example.com/pod-A.jpg",
      "https://test-fixture.example.com/pod-B.jpg",
    ];
    const event = buildEvent(AWB_DELIVERED, occurredAt, {
      action: "TASK_STATUS_UPDATED_TO_DELIVERED",
      eventTimestamp: occurredAt,
      deliveryInformation: { photos },
    });

    const result = await applyWebhookStatusEvent(TENANT, event, "TASK_STATUS_UPDATED_TO_DELIVERED");
    expect(result.applied).toBe(true);

    // Verify status flip + pod_photos write.
    const [task] = await withServiceRole("verify DELIVERED + pod_photos", async (tx) =>
      tx.execute(sqlTag`
        SELECT internal_status, pod_photos
        FROM tasks
        WHERE id = ${TASK_DELIVERED}
        LIMIT 1
      `),
    );
    expect((task as { internal_status: string }).internal_status).toBe("DELIVERED");
    expect((task as { pod_photos: unknown }).pod_photos).toEqual(photos);

    // Verify both audit events fired.
    const audits = await withServiceRole("verify both audit events", async (tx) =>
      tx.execute(sqlTag`
        SELECT event_type, metadata
        FROM audit_events
        WHERE tenant_id = ${TENANT}
          AND resource_id = ${TASK_DELIVERED}
          AND event_type IN ('task.status_changed_via_webhook', 'task.pod_received_via_webhook')
        ORDER BY occurred_at ASC
      `),
    );
    const types = audits.map((a) => (a as { event_type: string }).event_type).sort();
    expect(types).toEqual([
      "task.pod_received_via_webhook",
      "task.status_changed_via_webhook",
    ]);

    const podAudit = audits.find(
      (a) => (a as { event_type: string }).event_type === "task.pod_received_via_webhook",
    );
    const podMeta = (podAudit as { metadata: Record<string, unknown> }).metadata;
    expect(podMeta.photo_count).toBe(2);
    expect(podMeta.suitefleet_task_id).toBe(AWB_DELIVERED);
  });

  // ---------------------------------------------------------------------------
  // Day-19 T3 lookup-column regression — production stores the AWB on
  // tasks.external_tracking_number while tasks.external_id holds the SF
  // numeric id. The handler must look up by external_tracking_number to
  // resolve the parser-extracted AWB. Pre-fix the handler queried
  // external_id, which silently returned task_not_found against
  // production-shaped rows.
  // ---------------------------------------------------------------------------

  it("lookup uses external_tracking_number, not external_id, for AWB-keyed event", async () => {
    const occurredAt = "2026-05-09T18:00:00.000Z";

    // Positive case — fire with the AWB. Handler should resolve the
    // task and flip status (not return task_not_found).
    const matchEvent = buildEvent(AWB_LOOKUP_REGRESSION, occurredAt, {
      action: "TASK_STATUS_UPDATED_TO_PICKED_UP",
      eventTimestamp: occurredAt,
    });
    const matchResult = await applyWebhookStatusEvent(
      TENANT,
      matchEvent,
      "TASK_STATUS_UPDATED_TO_PICKED_UP",
    );
    expect(matchResult.applied).toBe(true);
    if (matchResult.applied) {
      expect(matchResult.taskId).toBe(TASK_LOOKUP_REGRESSION);
    }

    // Negative case — fire with the NUMERIC external_id as the AWB
    // payload field. Handler must NOT resolve the task (because it
    // looks up by external_tracking_number, which holds the AWB).
    const nonMatchEvent = buildEvent(EXT_ID_LOOKUP_REGRESSION, occurredAt, {
      action: "TASK_STATUS_UPDATED_TO_PICKED_UP",
      eventTimestamp: occurredAt,
    });
    const nonMatchResult = await applyWebhookStatusEvent(
      TENANT,
      nonMatchEvent,
      "TASK_STATUS_UPDATED_TO_PICKED_UP",
    );
    expect(nonMatchResult.applied).toBe(false);
    if (!nonMatchResult.applied) {
      expect(nonMatchResult.reason).toBe("task_not_found");
    }
  });
});
