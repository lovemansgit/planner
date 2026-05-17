// tests/integration/skip-sf-outbound-and-webhook-convergence.spec.ts
// =============================================================================
// Day-29 §D(2) Phase-1 — E2E + webhook collision regression suite
// per plan-PR #302 §8.3 cases 1 + 3. (Case 2 covers variant 3 reschedule
// webhook which is Phase 2 territory; not in this file.)
//
// Case 1 — happy-path skip→cancel→SF webhook ack convergence:
//   - operator skip on a materialized+pushed task → publisher enqueue
//   - simulate the SF webhook TASK_STATUS_UPDATED_TO_CANCELED arriving
//     (apply-webhook-status-event direct invocation)
//   - ASSERT: tasks.internal_status REMAINS 'SKIPPED' (NOT overwritten
//     by §6.2 webhook applier guard)
//   - ASSERT: webhook_events row INSERTed (audit preserved)
//
// Case 3 — DLQ failure path:
//   - simulate the QStash failureCallback firing at
//     /api/queue/cancel-task-failed (direct POST invocation through
//     the route handler)
//   - ASSERT: outbound_push_failures row exists with operation='cancel'
//     + correct correlation_id
//   - ASSERT: tasks.outbound_sync_state flipped from 'pending_cancel'
//     to 'failed' alongside the DLQ insert
//
// Mocks: publisher (skip the actual QStash publish so the test runs
// without QStash creds); QStash signature gate (passthrough for the
// failureCallback route invocation). All DB writes are real.
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Publisher mock — observable; does not actually publish to QStash.
const enqueueCancelTaskSpy = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../../src/modules/task-outbound-queue/publish", () => ({
  enqueueCancelTask: enqueueCancelTaskSpy,
  enqueueUpdateTask: vi.fn(async () => undefined),
  enqueueBulkCancelTasks: vi.fn(async () => ({
    enqueuedCount: 0,
    failedChunks: 0,
    totalCount: 0,
  })),
  enqueueBulkUpdateTasks: vi.fn(async () => ({
    enqueuedCount: 0,
    failedChunks: 0,
    totalCount: 0,
  })),
  __resetQStashClientForTest: vi.fn(),
}));

// QStash signature gate passthrough — lets the test POST raw without
// computing a signature.
vi.mock("@upstash/qstash/nextjs", () => ({
  verifySignatureAppRouter: vi.fn(
    (handler: (req: Request) => Promise<Response>) => handler,
  ),
}));

// Imports AFTER mocks.
import { withServiceRole, withTenant } from "../../src/shared/db";
import type { RequestContext } from "../../src/shared/tenant-context";
import type { Uuid } from "../../src/shared/types";

import { addSubscriptionException } from "../../src/modules/subscription-exceptions";
import { ALL_PERMISSION_IDS } from "../../src/modules/identity/permissions";
import { applyWebhookStatusEvent } from "../../src/modules/integration/providers/suitefleet/apply-webhook-status-event";
import { POST as cancelTaskFailedPost } from "../../src/app/api/queue/cancel-task-failed/route";
import type { WebhookEvent } from "../../src/modules/integration/types";

const RUN_ID = randomUUID().slice(0, 8);
const TENANT = randomUUID() as Uuid;
const SLUG = `d29-conv-${RUN_ID}`;
const USER = randomUUID() as Uuid;
const CONSIGNEE = randomUUID() as Uuid;
const ADDRESS = randomUUID() as Uuid;
const SUBSCRIPTION = randomUUID() as Uuid;
const TASK_WEBHOOK = randomUUID() as Uuid;
const TASK_DLQ = randomUUID() as Uuid;
const TRACKING_WEBHOOK = `AWB-D29-CONV-${RUN_ID}-WEBHOOK`;
const TRACKING_DLQ = `AWB-D29-CONV-${RUN_ID}-DLQ`;

function nextWedAfter(daysOffset: number): string {
  const dt = new Date(Date.now() + daysOffset * 24 * 60 * 60 * 1000);
  const day = dt.getUTCDay();
  const wedDelta = ((3 - day + 7) % 7) || 7;
  dt.setUTCDate(dt.getUTCDate() + wedDelta);
  return dt.toISOString().slice(0, 10);
}

const DATE_WEBHOOK = nextWedAfter(40);
const DATE_DLQ = nextWedAfter(50);
const SUBSCRIPTION_END = nextWedAfter(120);

function ctxFor(): RequestContext {
  return {
    actor: {
      kind: "user",
      userId: USER,
      tenantId: TENANT,
      permissions: new Set(ALL_PERMISSION_IDS) as unknown as Set<never>,
      email: `${USER}@d29-conv.example`,
      displayName: null,
    },
    tenantId: TENANT,
    requestId: `req-${RUN_ID}`,
    path: "/api/test",
  };
}

describe("Day-29 §D(2) Phase-1 — skip→SF outbound + webhook convergence", () => {
  beforeAll(async () => {
    await withServiceRole("d29-convergence seed", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, status)
        VALUES (${TENANT}, ${SLUG}, 'D29 Convergence Test', 'active')
      `);
      await tx.execute(sqlTag`
        INSERT INTO roles (tenant_id, name, slug, description) VALUES
          (NULL, 'Tenant Admin', 'tenant-admin', 'd29 conv seed')
        ON CONFLICT (tenant_id, slug) DO NOTHING
      `);
      await tx.execute(sqlTag`
        INSERT INTO auth.users (id, email)
        VALUES (${USER}, ${USER + "@d29-conv.example"})
      `);
      await tx.execute(sqlTag`
        INSERT INTO users (id, tenant_id, email)
        VALUES (${USER}, ${TENANT}, ${USER + "@d29-conv.example"})
      `);
      await tx.execute(sqlTag`
        INSERT INTO role_assignments (user_id, role_id, tenant_id)
        SELECT ${USER}, r.id, ${TENANT} FROM roles r
        WHERE r.tenant_id IS NULL AND r.slug = 'tenant-admin'
      `);
      await tx.execute(sqlTag`
        INSERT INTO consignees (id, tenant_id, name, email, phone,
          address_line, emirate_or_region, district)
        VALUES (${CONSIGNEE}, ${TENANT}, 'D29 Conv Consignee', 'cons@d29-conv.test',
                '+971500000099', 'Test Line', 'Dubai', 'Test District')
      `);
      await tx.execute(sqlTag`
        INSERT INTO addresses (id, tenant_id, consignee_id, label, is_primary, line, district, emirate)
        VALUES (${ADDRESS}, ${TENANT}, ${CONSIGNEE},
                'home', true, 'Test Line', 'Test District', 'Dubai')
      `);
      await tx.execute(sqlTag`
        INSERT INTO subscriptions (id, tenant_id, consignee_id, status, start_date, end_date,
          days_of_week, delivery_window_start, delivery_window_end)
        VALUES (${SUBSCRIPTION}, ${TENANT}, ${CONSIGNEE}, 'active',
          ${DATE_WEBHOOK}, ${SUBSCRIPTION_END},
          ARRAY[3]::int[], '09:00:00', '18:00:00')
      `);
      await tx.execute(sqlTag`
        INSERT INTO tasks (
          id, tenant_id, consignee_id, subscription_id, created_via,
          customer_order_number, internal_status, external_tracking_number,
          delivery_date, delivery_start_time, delivery_end_time,
          address_id, pushed_to_external_at
        ) VALUES
          (${TASK_WEBHOOK}, ${TENANT}, ${CONSIGNEE}, ${SUBSCRIPTION}, 'subscription',
           'ORD-WEBHOOK', 'CREATED', ${TRACKING_WEBHOOK},
           ${DATE_WEBHOOK}, '09:00:00', '18:00:00',
           ${ADDRESS}, now()),
          (${TASK_DLQ}, ${TENANT}, ${CONSIGNEE}, ${SUBSCRIPTION}, 'subscription',
           'ORD-DLQ', 'CREATED', ${TRACKING_DLQ},
           ${DATE_DLQ}, '09:00:00', '18:00:00',
           ${ADDRESS}, now())
      `);
    });
  });

  beforeEach(() => {
    enqueueCancelTaskSpy.mockReset();
    enqueueCancelTaskSpy.mockImplementation(async () => undefined);
  });

  // §8.3 case 1 — webhook collision guard preserves SKIPPED
  it("variant 1 happy path + SF webhook ack: tasks.internal_status REMAINS 'SKIPPED' (§6.2 guard); webhook_events row INSERTed", async () => {
    // Phase A — operator skip commits + enqueue (publisher mocked).
    const result = await addSubscriptionException(ctxFor(), SUBSCRIPTION, {
      type: "skip",
      date: DATE_WEBHOOK,
      idempotencyKey: randomUUID() as Uuid,
    });
    expect(result.status).toBe("inserted");
    expect(enqueueCancelTaskSpy).toHaveBeenCalledTimes(1);

    // Phase B — pre-webhook state assertion.
    await withTenant(TENANT, async (tx) => {
      type Row = { internal_status: string; outbound_sync_state: string };
      const rows = (await tx.execute(sqlTag`
        SELECT internal_status, outbound_sync_state
        FROM tasks WHERE id = ${TASK_WEBHOOK}
      `)) as readonly Row[];
      expect(rows[0].internal_status).toBe("SKIPPED");
      expect(rows[0].outbound_sync_state).toBe("pending_cancel");
    });

    // Phase C — simulate the SF webhook ack arriving ~1s post-PATCH.
    // applyWebhookStatusEvent is the apply function the receiver route
    // calls; invoking it directly mirrors the production code path.
    const fakeEvent: WebhookEvent = {
      kind: "TASK_STATUS_CHANGED",
      externalTaskId: TRACKING_WEBHOOK,
      occurredAt: new Date().toISOString(),
      idempotencyKey: `idem-${RUN_ID}-webhook`,
      raw: { taskId: TRACKING_WEBHOOK, status: "CANCELED" },
    };
    const applyResult = await applyWebhookStatusEvent(
      TENANT,
      fakeEvent,
      "TASK_STATUS_UPDATED_TO_CANCELED",
    );
    // Apply succeeds at the webhook_events INSERT layer regardless of
    // the SKIPPED guard. The applier's outcome.applied still reports
    // true even when the gated UPDATE no-ops on SKIPPED — the audit
    // intent is "this webhook was consumed."
    expect(applyResult.applied).toBe(true);

    // Phase D — POST-webhook state assertion: SKIPPED preserved.
    await withTenant(TENANT, async (tx) => {
      type Row = { internal_status: string };
      const rows = (await tx.execute(sqlTag`
        SELECT internal_status
        FROM tasks WHERE id = ${TASK_WEBHOOK}
      `)) as readonly Row[];
      expect(rows[0].internal_status).toBe("SKIPPED");
    });

    // Phase E — webhook_events row exists (audit trail preserved per
    // §3.6 OQ-6 ruling Option A: "webhook_events row STILL inserts").
    await withServiceRole("d29-conv webhook_events check", async (tx) => {
      type Row = { suitefleet_task_id: string; action: string };
      const rows = (await tx.execute(sqlTag`
        SELECT suitefleet_task_id, action
        FROM webhook_events
        WHERE suitefleet_task_id = ${TRACKING_WEBHOOK}
          AND action = 'TASK_STATUS_UPDATED_TO_CANCELED'
      `)) as readonly Row[];
      expect(rows.length).toBeGreaterThanOrEqual(1);
    });
  });

  // §8.3 case 3 — DLQ failure path
  it("DLQ failureCallback fires → outbound_push_failures row + tasks.outbound_sync_state='failed'", async () => {
    // Phase A — operator skip commits + enqueue (publisher mocked).
    const result = await addSubscriptionException(ctxFor(), SUBSCRIPTION, {
      type: "skip",
      date: DATE_DLQ,
      idempotencyKey: randomUUID() as Uuid,
    });
    expect(result.status).toBe("inserted");

    // Phase B — pre-DLQ state assertion.
    await withTenant(TENANT, async (tx) => {
      type Row = { outbound_sync_state: string };
      const rows = (await tx.execute(sqlTag`
        SELECT outbound_sync_state FROM tasks WHERE id = ${TASK_DLQ}
      `)) as readonly Row[];
      expect(rows[0].outbound_sync_state).toBe("pending_cancel");
    });

    // Phase C — simulate QStash failureCallback POST. The route
    // expects the canonical QStash failure body shape; sourceBody is
    // base64-encoded JSON payload (the original cancel-task message).
    const sourceBody = Buffer.from(
      JSON.stringify({
        tenant_id: TENANT,
        task_id: TASK_DLQ,
        awb: TRACKING_DLQ,
        correlation_id: result.correlationId,
      }),
    ).toString("base64");

    const failureBody = JSON.stringify({
      sourceMessageId: "msg-test-failure",
      sourceUrl: "http://localhost/api/queue/cancel-task",
      sourceBody,
      status: 500,
      body: '{"error":"sf 500"}',
      retried: 3,
      dlqId: "dlq-test-1",
    });

    const failureRequest = new Request(
      "http://localhost/api/queue/cancel-task-failed",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: failureBody,
      },
    );
    const failureResponse = await cancelTaskFailedPost(failureRequest);
    expect(failureResponse.status).toBe(200);

    // Phase D — outbound_push_failures row exists.
    await withServiceRole("d29-conv dlq row check", async (tx) => {
      type Row = { id: string; operation: string; failure_reason: string };
      const rows = (await tx.execute(sqlTag`
        SELECT id, operation, failure_reason
        FROM outbound_push_failures
        WHERE task_id = ${TASK_DLQ}
          AND correlation_id = ${result.correlationId}
      `)) as readonly Row[];
      expect(rows.length).toBe(1);
      expect(rows[0].operation).toBe("cancel");
      expect(rows[0].failure_reason).toBe("server_5xx");
    });

    // Phase E — outbound_sync_state flipped to 'failed'.
    await withTenant(TENANT, async (tx) => {
      type Row = { outbound_sync_state: string };
      const rows = (await tx.execute(sqlTag`
        SELECT outbound_sync_state FROM tasks WHERE id = ${TASK_DLQ}
      `)) as readonly Row[];
      expect(rows[0].outbound_sync_state).toBe("failed");
    });
  });
});
