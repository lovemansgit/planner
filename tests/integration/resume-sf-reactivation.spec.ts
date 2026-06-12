// tests/integration/resume-sf-reactivation.spec.ts
// =============================================================================
// Day-53 R16 — resume re-sync (SF re-activation on early-manual resume).
// Plan: memory/plans/day-53-r16-resume-sf-reactivation.md §4 — real
// Postgres, publishers mocked observable.
//
// Cases pinned:
//   1. Happy sibling path — pause flips pushed rows to pending_cancel;
//      early manual resume restores them to CREATED with **external ids
//      CLEARED + outbound_sync_state='pending'**, and exactly those task
//      ids reach enqueueTaskPushBatch. Covers BOTH pre-resume states:
//      webhook-converged ('synced') and still-in-flight ('pending_cancel').
//   2. Audit — subscription.resume_reactivations_pushed emitted once
//      with the registered metadata incl. previous_awbs forensics.
//   3. Partial fan-out failure — publisher reports failedChunks>0 →
//      service throws AFTER the emit; the local restore stays committed.
//   4. No-AWB rows — restored without id-clearing, no fan-out, no emit.
//   5. Auto-resume — restores nothing, no reactivation leg.
//   6. Old-AWB webhook safety — after the clear, a late
//      TASK_STATUS_UPDATED_TO_CANCELED for the OLD AWB cannot clobber
//      the restored row back to CANCELED (lookup by cleared
//      external_tracking_number = no match).
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// R2 pause-leg publisher mock (pause fans out SF cancels — not under test).
vi.mock("../../src/modules/task-outbound-queue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/modules/task-outbound-queue")>();
  return {
    ...actual,
    enqueueBulkCancelTasks: vi.fn(async (payloads: readonly unknown[]) => ({
      enqueuedCount: payloads.length,
      failedChunks: 0,
      totalCount: payloads.length,
    })),
  };
});

// R16 re-push publisher mock — observable.
const enqueueTaskPushBatchSpy = vi.hoisted(() =>
  vi.fn(async (input: { taskIds: readonly string[] }) => ({
    enqueuedCount: input.taskIds.length,
    failedChunks: 0,
  })),
);
vi.mock("../../src/modules/task-materialization/queue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/modules/task-materialization/queue")>();
  return { ...actual, enqueueTaskPushBatch: enqueueTaskPushBatchSpy };
});

// Imports AFTER mocks.
import { withServiceRole, withTenant } from "../../src/shared/db";
import type { RequestContext } from "../../src/shared/tenant-context";
import type { Uuid } from "../../src/shared/types";

import { ALL_PERMISSION_IDS } from "../../src/modules/identity/permissions";
import { applyWebhookStatusEvent } from "../../src/modules/integration/providers/suitefleet/apply-webhook-status-event";
import type { WebhookEvent } from "../../src/modules/integration/types";
import {
  pauseSubscription,
  resumeSubscription,
} from "../../src/modules/subscriptions/service";

const RUN_ID = randomUUID().slice(0, 8);
const TENANT = randomUUID() as Uuid;
const SLUG = `r16-${RUN_ID}`;
const USER = randomUUID() as Uuid;
const CONSIGNEE = randomUUID() as Uuid;
const ADDRESS = randomUUID() as Uuid;

// One subscription per resume scenario (resume fires once per pause).
const SUB_HAPPY = randomUUID() as Uuid;
const SUB_PARTIAL = randomUUID() as Uuid;
const SUB_UNPUSHED = randomUUID() as Uuid;
const SUB_AUTO = randomUUID() as Uuid;
const SUB_OPEN_ENDED = randomUUID() as Uuid;

// Wednesday-anchored dates, far future (cut-off safe).
function nextWedAfter(daysOffset: number): string {
  const dt = new Date(Date.now() + daysOffset * 24 * 60 * 60 * 1000);
  const day = dt.getUTCDay();
  const wedDelta = ((3 - day + 7) % 7) || 7;
  dt.setUTCDate(dt.getUTCDate() + wedDelta);
  return dt.toISOString().slice(0, 10);
}
const WED_1 = nextWedAfter(30);
const WED_2 = nextWedAfter(37);
const SUB_END = nextWedAfter(180);
function dayBefore(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
function dayAfter(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
const PAUSE_START = dayBefore(WED_1);
const PAUSE_END = dayAfter(WED_2);

function ctxFor(): RequestContext {
  return {
    actor: {
      kind: "user",
      userId: USER,
      tenantId: TENANT,
      permissions: new Set(ALL_PERMISSION_IDS) as unknown as Set<never>,
      email: `${USER}@r16.example`,
      displayName: null,
    },
    tenantId: TENANT,
    requestId: `req-${RUN_ID}`,
    path: "/api/test",
  };
}

function systemCtx(): RequestContext {
  return {
    actor: {
      kind: "system",
      system: "cron:auto_resume",
      tenantId: TENANT,
      permissions: new Set(ALL_PERMISSION_IDS) as unknown as Set<never>,
    } as never,
    tenantId: TENANT,
    requestId: `req-${RUN_ID}-auto`,
    path: "/api/cron/auto-resume",
  };
}

async function seedSubscription(
  subId: Uuid,
  endDate: string | null = SUB_END,
): Promise<void> {
  await withServiceRole(`r16 seed sub ${subId}`, async (tx) => {
    await tx.execute(sqlTag`
      INSERT INTO subscriptions (id, tenant_id, consignee_id, status, start_date, end_date,
        days_of_week, delivery_window_start, delivery_window_end)
      VALUES (${subId}, ${TENANT}, ${CONSIGNEE}, 'active',
        ${WED_1}, ${endDate}, ARRAY[3]::int[], '09:00:00', '18:00:00')
    `);
  });
}

interface SeedTask {
  readonly id: Uuid;
  readonly date: string;
  readonly awb: string | null;
}

async function seedTasks(subId: Uuid, tasks: readonly SeedTask[]): Promise<void> {
  await withServiceRole(`r16 seed tasks ${subId}`, async (tx) => {
    for (const t of tasks) {
      await tx.execute(sqlTag`
        INSERT INTO tasks (
          id, tenant_id, consignee_id, subscription_id, created_via,
          customer_order_number, internal_status, external_id,
          external_tracking_number, delivery_date, delivery_start_time,
          delivery_end_time, address_id, pushed_to_external_at,
          outbound_sync_state
        ) VALUES (
          ${t.id}, ${TENANT}, ${CONSIGNEE}, ${subId}, 'subscription',
          ${`R16-${RUN_ID}-${t.id.slice(0, 8)}`}, 'CREATED',
          ${t.awb !== null ? `ext-${t.id.slice(0, 8)}` : null},
          ${t.awb}, ${t.date}, '09:00:00', '18:00:00',
          ${ADDRESS}, ${t.awb !== null ? sqlTag`now()` : null},
          ${t.awb !== null ? "synced" : "pending"}
        )
      `);
    }
  });
}

type TaskRow = {
  internal_status: string;
  external_id: string | null;
  external_tracking_number: string | null;
  pushed_to_external_at: string | null;
  outbound_sync_state: string;
};

async function readTask(taskId: Uuid): Promise<TaskRow> {
  return withTenant(TENANT, async (tx) => {
    const rows = (await tx.execute(sqlTag`
      SELECT internal_status, external_id, external_tracking_number,
             pushed_to_external_at::text AS pushed_to_external_at,
             outbound_sync_state
      FROM tasks WHERE id = ${taskId}
    `)) as readonly TaskRow[];
    return rows[0];
  });
}

describe("Day-53 R16 — resume SF re-activation (real Postgres)", () => {
  beforeAll(async () => {
    await withServiceRole("r16 seed base", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, status)
        VALUES (${TENANT}, ${SLUG}, 'R16 Test', 'active')
      `);
      await tx.execute(sqlTag`
        INSERT INTO roles (tenant_id, name, slug, description) VALUES
          (NULL, 'Tenant Admin', 'tenant-admin', 'r16 seed')
        ON CONFLICT (tenant_id, slug) DO NOTHING
      `);
      await tx.execute(sqlTag`
        INSERT INTO auth.users (id, email)
        VALUES (${USER}, ${USER + "@r16.example"})
      `);
      await tx.execute(sqlTag`
        INSERT INTO users (id, tenant_id, email)
        VALUES (${USER}, ${TENANT}, ${USER + "@r16.example"})
      `);
      await tx.execute(sqlTag`
        INSERT INTO role_assignments (user_id, role_id, tenant_id)
        SELECT ${USER}, r.id, ${TENANT} FROM roles r
        WHERE r.tenant_id IS NULL AND r.slug = 'tenant-admin'
      `);
      await tx.execute(sqlTag`
        INSERT INTO consignees (id, tenant_id, name, email, phone,
          address_line, emirate_or_region, district)
        VALUES (${CONSIGNEE}, ${TENANT}, 'R16 Consignee', 'cons@r16.test',
                '+971500000098', 'Test Line', 'Dubai', 'Test District')
      `);
      await tx.execute(sqlTag`
        INSERT INTO addresses (id, tenant_id, consignee_id, label, is_primary, line, district, emirate)
        VALUES (${ADDRESS}, ${TENANT}, ${CONSIGNEE},
                'home', true, 'Test Line', 'Test District', 'Dubai')
      `);
    });
  });

  beforeEach(() => {
    enqueueTaskPushBatchSpy.mockClear();
    enqueueTaskPushBatchSpy.mockImplementation(
      async (input: { taskIds: readonly string[] }) => ({
        enqueuedCount: input.taskIds.length,
        failedChunks: 0,
      }),
    );
  });

  it("case 1+2 — early manual resume clears ids on SF-cancelled rows ('synced' AND 'pending_cancel'), re-pushes exactly those, emits the audit event with previous_awbs", async () => {
    const taskConverged = randomUUID() as Uuid;
    const taskInFlight = randomUUID() as Uuid;
    const awbConverged = `AWB-R16-${RUN_ID}-CONV`;
    const awbInFlight = `AWB-R16-${RUN_ID}-FLIGHT`;
    await seedSubscription(SUB_HAPPY);
    await seedTasks(SUB_HAPPY, [
      { id: taskConverged, date: WED_1, awb: awbConverged },
      { id: taskInFlight, date: WED_2, awb: awbInFlight },
    ]);

    const pause = await pauseSubscription(ctxFor(), SUB_HAPPY, {
      pause_start: PAUSE_START,
      pause_end: PAUSE_END,
      idempotency_key: randomUUID(),
    });
    expect(pause.status).toBe("inserted");
    // Both pushed rows now CANCELED + pending_cancel (R2). Simulate the
    // SF cancel webhook converging ONE of them back to 'synced' — the
    // common state by the time a resume happens.
    await withServiceRole("r16 converge one", async (tx) => {
      await tx.execute(sqlTag`
        UPDATE tasks SET outbound_sync_state = 'synced' WHERE id = ${taskConverged}
      `);
    });

    const result = await resumeSubscription(ctxFor(), SUB_HAPPY, {
      idempotency_key: randomUUID(),
    });
    expect(result.status).toBe("resumed");
    expect(result.restored_task_count).toBe(2);
    expect(result.reactivated_task_count).toBe(2);

    // Rows: CREATED, ids CLEARED, honest 'pending' state.
    for (const id of [taskConverged, taskInFlight]) {
      const row = await readTask(id);
      expect(row.internal_status).toBe("CREATED");
      expect(row.external_id).toBeNull();
      expect(row.external_tracking_number).toBeNull();
      expect(row.pushed_to_external_at).toBeNull();
      expect(row.outbound_sync_state).toBe("pending");
    }

    // Fan-out saw exactly the two cleared rows.
    expect(enqueueTaskPushBatchSpy).toHaveBeenCalledTimes(1);
    const call = enqueueTaskPushBatchSpy.mock.calls[0][0] as {
      tenantId: string;
      taskIds: readonly string[];
    };
    expect(call.tenantId).toBe(TENANT);
    expect([...call.taskIds].sort()).toEqual([taskConverged, taskInFlight].sort());

    // Audit event with previous_awbs forensics.
    const events = await withServiceRole("r16 audit read", async (tx) =>
      tx.execute(sqlTag`
        SELECT metadata FROM audit_events
        WHERE event_type = 'subscription.resume_reactivations_pushed'
          AND resource_id = ${SUB_HAPPY}
      `),
    );
    expect(events).toHaveLength(1);
    const meta = (events[0] as { metadata: Record<string, unknown> }).metadata;
    expect(meta.subscription_id).toBe(SUB_HAPPY);
    expect(meta.correlation_id).toBe(result.correlation_id);
    expect(meta.reactivated_task_count).toBe(2);
    expect(meta.enqueued_count).toBe(2);
    expect(meta.failed_chunks).toBe(0);
    const previousAwbs = meta.previous_awbs as readonly { task_id: string; awb: string }[];
    expect([...previousAwbs].sort((a, b) => a.awb.localeCompare(b.awb))).toEqual([
      { task_id: taskConverged, awb: awbConverged },
      { task_id: taskInFlight, awb: awbInFlight },
    ]);
  });

  it("case 6 — late webhook for the OLD AWB cannot clobber the restored row", async () => {
    // SUB_HAPPY's rows were cleared in case 1. Apply a late CANCELED
    // webhook for one old AWB — the lookup must find no row and the
    // restored task must stay CREATED.
    const fakeEvent: WebhookEvent = {
      kind: "TASK_STATUS_CHANGED",
      externalTaskId: `AWB-R16-${RUN_ID}-CONV`,
      occurredAt: new Date().toISOString(),
      idempotencyKey: `idem-${RUN_ID}-late-cancel`,
      raw: { taskId: `AWB-R16-${RUN_ID}-CONV`, status: "CANCELED" },
    };
    await applyWebhookStatusEvent(TENANT, fakeEvent, "TASK_STATUS_UPDATED_TO_CANCELED");

    const rows = await withTenant(TENANT, async (tx) =>
      tx.execute<{ internal_status: string }>(sqlTag`
        SELECT internal_status FROM tasks
        WHERE subscription_id = ${SUB_HAPPY}
        ORDER BY delivery_date
      `),
    );
    for (const row of rows) {
      expect(row.internal_status).toBe("CREATED");
    }
  });

  it("case 3 — partial fan-out failure: throws AFTER the emit; local restore stays committed", async () => {
    const task = randomUUID() as Uuid;
    await seedSubscription(SUB_PARTIAL);
    await seedTasks(SUB_PARTIAL, [
      { id: task, date: WED_1, awb: `AWB-R16-${RUN_ID}-PART` },
    ]);
    await pauseSubscription(ctxFor(), SUB_PARTIAL, {
      pause_start: PAUSE_START,
      pause_end: PAUSE_END,
      idempotency_key: randomUUID(),
    });

    enqueueTaskPushBatchSpy.mockImplementation(async () => ({
      enqueuedCount: 0,
      failedChunks: 1,
    }));

    await expect(
      resumeSubscription(ctxFor(), SUB_PARTIAL, { idempotency_key: randomUUID() }),
    ).rejects.toThrow(/re-activation fan-out partially failed/);

    // Restore is committed; the row sits in 'pending' for the
    // materializer reconciliation sweep.
    const row = await readTask(task);
    expect(row.internal_status).toBe("CREATED");
    expect(row.outbound_sync_state).toBe("pending");
    expect(row.external_tracking_number).toBeNull();

    // The emit fired BEFORE the throw.
    const events = await withServiceRole("r16 partial audit read", async (tx) =>
      tx.execute(sqlTag`
        SELECT metadata FROM audit_events
        WHERE event_type = 'subscription.resume_reactivations_pushed'
          AND resource_id = ${SUB_PARTIAL}
      `),
    );
    expect(events).toHaveLength(1);
    expect(
      (events[0] as { metadata: { failed_chunks: number } }).metadata.failed_chunks,
    ).toBe(1);
  });

  it("case 4 — unpushed rows restore without id-clearing; no fan-out, no emit", async () => {
    const task = randomUUID() as Uuid;
    await seedSubscription(SUB_UNPUSHED);
    await seedTasks(SUB_UNPUSHED, [{ id: task, date: WED_1, awb: null }]);
    await pauseSubscription(ctxFor(), SUB_UNPUSHED, {
      pause_start: PAUSE_START,
      pause_end: PAUSE_END,
      idempotency_key: randomUUID(),
    });

    const result = await resumeSubscription(ctxFor(), SUB_UNPUSHED, {
      idempotency_key: randomUUID(),
    });
    expect(result.status).toBe("resumed");
    expect(result.restored_task_count).toBe(1);
    expect(result.reactivated_task_count).toBe(0);

    const row = await readTask(task);
    expect(row.internal_status).toBe("CREATED");
    expect(row.outbound_sync_state).toBe("pending"); // unchanged seed state
    expect(enqueueTaskPushBatchSpy).not.toHaveBeenCalled();

    const events = await withServiceRole("r16 unpushed audit read", async (tx) =>
      tx.execute(sqlTag`
        SELECT id FROM audit_events
        WHERE event_type = 'subscription.resume_reactivations_pushed'
          AND resource_id = ${SUB_UNPUSHED}
      `),
    );
    expect(events).toEqual([]);
  });

  it("case 5 — auto-resume restores nothing and has no reactivation leg", async () => {
    const task = randomUUID() as Uuid;
    await seedSubscription(SUB_AUTO);
    await seedTasks(SUB_AUTO, [
      { id: task, date: WED_1, awb: `AWB-R16-${RUN_ID}-AUTO` },
    ]);
    await pauseSubscription(ctxFor(), SUB_AUTO, {
      pause_start: PAUSE_START,
      pause_end: PAUSE_END,
      idempotency_key: randomUUID(),
    });

    const result = await resumeSubscription(
      systemCtx(),
      SUB_AUTO,
      { idempotency_key: randomUUID() },
      { is_auto_resume: true },
    );
    expect(result.status).toBe("resumed");
    expect(result.restored_task_count).toBe(0);
    expect(result.reactivated_task_count).toBe(0);
    expect(enqueueTaskPushBatchSpy).not.toHaveBeenCalled();

    // The pause-cancelled row stays CANCELED with its AWB intact.
    const row = await readTask(task);
    expect(row.internal_status).toBe("CANCELED");
    expect(row.external_tracking_number).toBe(`AWB-R16-${RUN_ID}-AUTO`);
  });

  it("case 7 — OPEN-ENDED subscription: early manual resume restores and re-activates exactly like the end-dated path", async () => {
    // Day-54 smoke find (memory/followup_r16_open_ended_resume_gap.md):
    // with end_date NULL the whole restore block was skipped — tasks
    // stranded CANCELED on both sides, no event. This case pins the
    // full case-1 contract on a NULL-end-date subscription.
    const task = randomUUID() as Uuid;
    const awb = `AWB-R16-${RUN_ID}-OPEN`;
    await seedSubscription(SUB_OPEN_ENDED, null);
    await seedTasks(SUB_OPEN_ENDED, [{ id: task, date: WED_1, awb }]);

    const pause = await pauseSubscription(ctxFor(), SUB_OPEN_ENDED, {
      pause_start: PAUSE_START,
      pause_end: PAUSE_END,
      idempotency_key: randomUUID(),
    });
    expect(pause.status).toBe("inserted");

    const result = await resumeSubscription(ctxFor(), SUB_OPEN_ENDED, {
      idempotency_key: randomUUID(),
    });
    expect(result.status).toBe("resumed");
    expect(result.restored_task_count).toBe(1);
    expect(result.reactivated_task_count).toBe(1);
    // No extension was granted at pause time (extension is end-date-gated),
    // so there is nothing to shrink — new_end_date stays null.
    expect(result.new_end_date).toBeNull();

    const row = await readTask(task);
    expect(row.internal_status).toBe("CREATED");
    expect(row.external_id).toBeNull();
    expect(row.external_tracking_number).toBeNull();
    expect(row.pushed_to_external_at).toBeNull();
    expect(row.outbound_sync_state).toBe("pending");

    expect(enqueueTaskPushBatchSpy).toHaveBeenCalledTimes(1);
    const call = enqueueTaskPushBatchSpy.mock.calls[0][0] as {
      taskIds: readonly string[];
    };
    expect([...call.taskIds]).toEqual([task]);

    const events = await withServiceRole("r16 open-ended audit read", async (tx) =>
      tx.execute(sqlTag`
        SELECT metadata FROM audit_events
        WHERE event_type = 'subscription.resume_reactivations_pushed'
          AND resource_id = ${SUB_OPEN_ENDED}
      `),
    );
    expect(events).toHaveLength(1);
    const meta = (events[0] as { metadata: Record<string, unknown> }).metadata;
    expect(meta.reactivated_task_count).toBe(1);
    expect(meta.previous_awbs).toEqual([{ task_id: task, awb }]);
  });
});
