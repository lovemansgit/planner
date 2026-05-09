// tests/integration/webhook-pod-received.spec.ts
// =============================================================================
// Day-18 / A2 Layer 3 — POD-reception contract (separate file from
// the broader Layer-2 status spec for grep-friendliness; per plan §9.3).
//
// Per plan §4.6 Option (a) ruling, POD writing is folded into
// Layer 2's applyWebhookStatusEvent (atomic with status flip) — but
// the contract IS a Layer-3 concern (POD URL extraction; new column;
// new audit event type). This file pins the POD-specific assertions
// independently of the broader status spec.
//
// Coverage:
//   1. POD URLs land in tasks.pod_photos verbatim on
//      TASK_STATUS_UPDATED_TO_DELIVERED.
//   2. Both audit events fire — task.status_changed_via_webhook AND
//      task.pod_received_via_webhook.
//   3. photo_count metadata matches the array length.
//   4. Empty-array photos → pod_photos stays NULL (extractPodPhotos
//      normalises empty → null per the §4.4 ruling code-PR-time
//      decision: "empty array as forensic signal" was rejected
//      because webhook_events.raw_payload preserves the empty array).
//   5. Missing deliveryInformation.photos field → pod_photos NULL
//      after DELIVERED flip; only task.status_changed_via_webhook fires
//      (no POD audit).
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
const SLUG = `wpr-${RUN_ID}`;
const CONSIGNEE = randomUUID();

const AWB_POPULATED = `WPR-${RUN_ID}-POPULATED`;
const AWB_EMPTY = `WPR-${RUN_ID}-EMPTY`;
const AWB_MISSING = `WPR-${RUN_ID}-MISSING`;
const AWB_DUPLICATE = `WPR-${RUN_ID}-DUP`;

const TASK_POPULATED = randomUUID() as Uuid;
const TASK_EMPTY = randomUUID() as Uuid;
const TASK_MISSING = randomUUID() as Uuid;
const TASK_DUPLICATE = randomUUID() as Uuid;

function buildDeliveredEvent(
  awb: string,
  occurredAt: string,
  deliveryInformation: Record<string, unknown> | undefined,
): WebhookEvent {
  return {
    kind: "TASK_STATUS_CHANGED",
    externalTaskId: awb,
    occurredAt,
    idempotencyKey: `key-pod-${awb}-${occurredAt}`,
    raw: {
      awb,
      action: "TASK_STATUS_UPDATED_TO_DELIVERED",
      eventTimestamp: occurredAt,
      ...(deliveryInformation === undefined ? {} : { deliveryInformation }),
    },
  };
}

describe("Day-18 / A2 Layer 3 — POD reception (real Postgres)", () => {
  beforeAll(async () => {
    await withServiceRole("Day-18 A2 POD integration setup", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, status) VALUES
          (${TENANT}, ${SLUG}, 'WPR A2 POD Test', 'active')
      `);
      await tx.execute(sqlTag`
        INSERT INTO consignees (id, tenant_id, name, phone, address_line, emirate_or_region, district)
        VALUES
          (${CONSIGNEE}, ${TENANT}, 'WPR Test Consignee', ${`+97150p${RUN_ID}`},
           'Test Building', 'Dubai', 'Test District')
      `);
      await tx.execute(sqlTag`
        INSERT INTO tasks (
          id, tenant_id, consignee_id, customer_order_number, external_id,
          internal_status, delivery_date, delivery_start_time, delivery_end_time,
          created_via
        ) VALUES
          (${TASK_POPULATED}, ${TENANT}, ${CONSIGNEE}, ${`WPR-P-${RUN_ID}`},
           ${AWB_POPULATED}, 'IN_TRANSIT', '2026-05-09', '08:00', '10:00', 'manual_admin'),
          (${TASK_EMPTY}, ${TENANT}, ${CONSIGNEE}, ${`WPR-E-${RUN_ID}`},
           ${AWB_EMPTY}, 'IN_TRANSIT', '2026-05-09', '08:00', '10:00', 'manual_admin'),
          (${TASK_MISSING}, ${TENANT}, ${CONSIGNEE}, ${`WPR-M-${RUN_ID}`},
           ${AWB_MISSING}, 'IN_TRANSIT', '2026-05-09', '08:00', '10:00', 'manual_admin'),
          (${TASK_DUPLICATE}, ${TENANT}, ${CONSIGNEE}, ${`WPR-D-${RUN_ID}`},
           ${AWB_DUPLICATE}, 'IN_TRANSIT', '2026-05-09', '08:00', '10:00', 'manual_admin')
      `);
    });
  });

  it("populated photos array → pod_photos jsonb + both audit events fire", async () => {
    const occurredAt = "2026-05-09T14:00:00.000Z";
    const photos = [
      "https://test-fixture.example.com/pod-1.jpg",
      "https://test-fixture.example.com/pod-2.jpg",
      "https://test-fixture.example.com/pod-3.jpg",
    ];
    const event = buildDeliveredEvent(AWB_POPULATED, occurredAt, { photos });

    const result = await applyWebhookStatusEvent(
      TENANT,
      event,
      "TASK_STATUS_UPDATED_TO_DELIVERED",
    );
    expect(result.applied).toBe(true);

    const [task] = await withServiceRole("verify pod_photos populated", async (tx) =>
      tx.execute(sqlTag`
        SELECT internal_status, pod_photos
        FROM tasks WHERE id = ${TASK_POPULATED} LIMIT 1
      `),
    );
    expect((task as { internal_status: string }).internal_status).toBe("DELIVERED");
    expect((task as { pod_photos: unknown }).pod_photos).toEqual(photos);

    // Both audit events fire.
    const audits = await withServiceRole("verify both audits", async (tx) =>
      tx.execute(sqlTag`
        SELECT event_type, metadata FROM audit_events
        WHERE tenant_id = ${TENANT} AND resource_id = ${TASK_POPULATED}
          AND event_type IN ('task.status_changed_via_webhook', 'task.pod_received_via_webhook')
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
    const meta = (podAudit as { metadata: Record<string, unknown> }).metadata;
    expect(meta.photo_count).toBe(3);
  });

  it("empty photos array → pod_photos stays NULL; no POD audit fires (only status audit)", async () => {
    const occurredAt = "2026-05-09T14:30:00.000Z";
    const event = buildDeliveredEvent(AWB_EMPTY, occurredAt, { photos: [] });

    const result = await applyWebhookStatusEvent(
      TENANT,
      event,
      "TASK_STATUS_UPDATED_TO_DELIVERED",
    );
    expect(result.applied).toBe(true);

    const [task] = await withServiceRole("verify pod_photos null on empty", async (tx) =>
      tx.execute(sqlTag`SELECT internal_status, pod_photos FROM tasks WHERE id = ${TASK_EMPTY} LIMIT 1`),
    );
    expect((task as { internal_status: string }).internal_status).toBe("DELIVERED");
    expect((task as { pod_photos: unknown }).pod_photos).toBeNull();

    // No POD audit emitted; only status audit.
    const podAudits = await withServiceRole("verify no POD audit on empty", async (tx) =>
      tx.execute(sqlTag`
        SELECT id FROM audit_events
        WHERE event_type = 'task.pod_received_via_webhook'
          AND tenant_id = ${TENANT}
          AND resource_id = ${TASK_EMPTY}
      `),
    );
    expect(podAudits).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // Day-19 T2 regression — pin POD-path dedup against the drizzle-wrap bug
  // (memory/followup_isuniqueviolation_err_cause_unwrap_bug.md). Pre-fix the
  // second call rethrew the wrapped DrizzleQueryError; post-fix
  // isUniqueViolation walks err.cause and the dedup branch returns cleanly.
  // ---------------------------------------------------------------------------

  it("duplicate DELIVERED replay returns reason='duplicate'; no double-write to webhook_events or audit", async () => {
    const occurredAt = "2026-05-09T16:00:00.000Z";
    const photos = [
      "https://test-fixture.example.com/dup-pod-1.jpg",
      "https://test-fixture.example.com/dup-pod-2.jpg",
    ];
    const event = buildDeliveredEvent(AWB_DUPLICATE, occurredAt, { photos });

    const first = await applyWebhookStatusEvent(
      TENANT,
      event,
      "TASK_STATUS_UPDATED_TO_DELIVERED",
    );
    expect(first.applied).toBe(true);

    const [{ count: preWh }] = (await withServiceRole(
      "count webhook_events pre-replay",
      async (tx) =>
        tx.execute(
          sqlTag`SELECT COUNT(*)::int AS count FROM webhook_events WHERE suitefleet_task_id = ${AWB_DUPLICATE}`,
        ),
    )) as readonly { count: number }[];
    const [{ count: preAudit }] = (await withServiceRole(
      "count audit pre-replay",
      async (tx) =>
        tx.execute(sqlTag`
          SELECT COUNT(*)::int AS count FROM audit_events
          WHERE tenant_id = ${TENANT}
            AND resource_id = ${TASK_DUPLICATE}
            AND event_type IN ('task.status_changed_via_webhook', 'task.pod_received_via_webhook')
        `),
    )) as readonly { count: number }[];

    const second = await applyWebhookStatusEvent(
      TENANT,
      event,
      "TASK_STATUS_UPDATED_TO_DELIVERED",
    );
    expect(second.applied).toBe(false);
    if (!second.applied) {
      expect(second.reason).toBe("duplicate");
    }

    const [{ count: postWh }] = (await withServiceRole(
      "count webhook_events post-replay",
      async (tx) =>
        tx.execute(
          sqlTag`SELECT COUNT(*)::int AS count FROM webhook_events WHERE suitefleet_task_id = ${AWB_DUPLICATE}`,
        ),
    )) as readonly { count: number }[];
    const [{ count: postAudit }] = (await withServiceRole(
      "count audit post-replay",
      async (tx) =>
        tx.execute(sqlTag`
          SELECT COUNT(*)::int AS count FROM audit_events
          WHERE tenant_id = ${TENANT}
            AND resource_id = ${TASK_DUPLICATE}
            AND event_type IN ('task.status_changed_via_webhook', 'task.pod_received_via_webhook')
        `),
    )) as readonly { count: number }[];

    expect(postWh).toBe(preWh);
    expect(postAudit).toBe(preAudit);
  });

  it("missing photos field → pod_photos NULL; no POD audit fires", async () => {
    const occurredAt = "2026-05-09T15:00:00.000Z";
    const event = buildDeliveredEvent(AWB_MISSING, occurredAt, undefined);

    const result = await applyWebhookStatusEvent(
      TENANT,
      event,
      "TASK_STATUS_UPDATED_TO_DELIVERED",
    );
    expect(result.applied).toBe(true);

    const [task] = await withServiceRole("verify pod_photos null on missing", async (tx) =>
      tx.execute(sqlTag`SELECT pod_photos FROM tasks WHERE id = ${TASK_MISSING} LIMIT 1`),
    );
    expect((task as { pod_photos: unknown }).pod_photos).toBeNull();

    const podAudits = await withServiceRole("verify no POD audit on missing", async (tx) =>
      tx.execute(sqlTag`
        SELECT id FROM audit_events
        WHERE event_type = 'task.pod_received_via_webhook'
          AND tenant_id = ${TENANT}
          AND resource_id = ${TASK_MISSING}
      `),
    );
    expect(podAudits).toEqual([]);
  });
});
