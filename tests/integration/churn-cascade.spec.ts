// tests/integration/churn-cascade.spec.ts
// =============================================================================
// Day-54 R-E — churn hard-stop cascade on real Postgres.
// Plan: memory/plans/day-54-session-c-re-churn-cascade.md §5.
//
// Cases pinned:
//   1. CHURNED transition: both subscriptions (active + paused) end;
//      the unpushed CREATED task cancels locally; the pushed CREATED
//      and pushed ASSIGNED tasks flip to pending_cancel with their
//      internal_status PRESERVED (honesty rule — ASSIGNED stays
//      ASSIGNED until the vendor confirms); the DELIVERED task is
//      untouched; the fan-out received exactly the two AWBs; the
//      consignee.churn_cascade audit row carries the counts.
//   2. Guard: a non-churn transition (ACTIVE → ON_HOLD on a second
//      consignee) cascades NOTHING.
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const enqueueBulkCancelTasksSpy = vi.hoisted(() =>
  vi.fn(async (payloads: readonly unknown[]) => ({
    enqueuedCount: payloads.length,
    failedChunks: 0,
    totalCount: payloads.length,
  })),
);
vi.mock("../../src/modules/task-outbound-queue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/modules/task-outbound-queue")>();
  return { ...actual, enqueueBulkCancelTasks: enqueueBulkCancelTasksSpy };
});

import { withServiceRole } from "../../src/shared/db";
import type { RequestContext } from "../../src/shared/tenant-context";
import type { Uuid } from "../../src/shared/types";

import { ALL_PERMISSION_IDS } from "../../src/modules/identity/permissions";
import { changeConsigneeCrmState } from "../../src/modules/consignees/service";

const RUN_ID = randomUUID().slice(0, 8);
const TENANT = randomUUID() as Uuid;
const SLUG = `churn-${RUN_ID}`;
const USER = randomUUID() as Uuid;
const CONSIGNEE = randomUUID() as Uuid;
const CONSIGNEE_2 = randomUUID() as Uuid;
const ADDRESS = randomUUID() as Uuid;
const SUB_ACTIVE = randomUUID() as Uuid;
const SUB_PAUSED = randomUUID() as Uuid;

const TASK_UNPUSHED = randomUUID() as Uuid;
const TASK_PUSHED = randomUUID() as Uuid;
const TASK_ASSIGNED = randomUUID() as Uuid;
const TASK_DELIVERED = randomUUID() as Uuid;

const AWB_PUSHED = `CHURN-${RUN_ID}-P`;
const AWB_ASSIGNED = `CHURN-${RUN_ID}-A`;

function nextWedAfter(daysOffset: number): string {
  const dt = new Date(Date.now() + daysOffset * 24 * 60 * 60 * 1000);
  const day = dt.getUTCDay();
  const wedDelta = ((3 - day + 7) % 7) || 7;
  dt.setUTCDate(dt.getUTCDate() + wedDelta);
  return dt.toISOString().slice(0, 10);
}
const WED_1 = nextWedAfter(30);
const WED_2 = nextWedAfter(37);
const WED_3 = nextWedAfter(44);
const SUB_END = nextWedAfter(180);

function ctxFor(): RequestContext {
  return {
    actor: {
      kind: "user",
      userId: USER,
      tenantId: TENANT,
      permissions: new Set(ALL_PERMISSION_IDS) as unknown as Set<never>,
      email: `${USER}@churn.example`,
      displayName: null,
    },
    tenantId: TENANT,
    requestId: `req-${RUN_ID}`,
    path: "/api/test",
  };
}

type TaskRow = { internal_status: string; outbound_sync_state: string };
async function readTask(taskId: Uuid): Promise<TaskRow> {
  return withServiceRole("churn read task", async (tx) => {
    const rows = (await tx.execute(sqlTag`
      SELECT internal_status, outbound_sync_state FROM tasks WHERE id = ${taskId}
    `)) as readonly TaskRow[];
    return rows[0];
  });
}

describe("Day-54 R-E — churn hard-stop cascade (real Postgres)", () => {
  beforeAll(async () => {
    await withServiceRole("churn seed base", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, status)
        VALUES (${TENANT}, ${SLUG}, 'Churn Test', 'active')
      `);
      await tx.execute(sqlTag`
        INSERT INTO roles (tenant_id, name, slug, description) VALUES
          (NULL, 'Tenant Admin', 'tenant-admin', 'churn seed')
        ON CONFLICT (tenant_id, slug) DO NOTHING
      `);
      await tx.execute(sqlTag`
        INSERT INTO auth.users (id, email) VALUES (${USER}, ${USER + "@churn.example"})
      `);
      await tx.execute(sqlTag`
        INSERT INTO users (id, tenant_id, email)
        VALUES (${USER}, ${TENANT}, ${USER + "@churn.example"})
      `);
      await tx.execute(sqlTag`
        INSERT INTO role_assignments (user_id, role_id, tenant_id)
        SELECT ${USER}, r.id, ${TENANT} FROM roles r
        WHERE r.tenant_id IS NULL AND r.slug = 'tenant-admin'
      `);
      await tx.execute(sqlTag`
        INSERT INTO consignees (id, tenant_id, name, email, phone,
          address_line, emirate_or_region, district, crm_state)
        VALUES
          (${CONSIGNEE}, ${TENANT}, 'Churn Consignee', 'c1@churn.test',
           '+971500000094', 'Test Line', 'Dubai', 'Test District', 'ACTIVE'),
          (${CONSIGNEE_2}, ${TENANT}, 'Guard Consignee', 'c2@churn.test',
           '+971500000093', 'Test Line', 'Dubai', 'Test District', 'ACTIVE')
      `);
      await tx.execute(sqlTag`
        INSERT INTO addresses (id, tenant_id, consignee_id, label, is_primary, line, district, emirate)
        VALUES (${ADDRESS}, ${TENANT}, ${CONSIGNEE},
                'home', true, 'Test Line', 'Test District', 'Dubai')
      `);
      await tx.execute(sqlTag`
        INSERT INTO subscriptions (id, tenant_id, consignee_id, status, start_date, end_date,
          days_of_week, delivery_window_start, delivery_window_end, paused_at)
        VALUES
          (${SUB_ACTIVE}, ${TENANT}, ${CONSIGNEE}, 'active',
           ${WED_1}, ${SUB_END}, ARRAY[3]::int[], '09:00:00', '18:00:00', NULL),
          (${SUB_PAUSED}, ${TENANT}, ${CONSIGNEE}, 'paused',
           ${WED_1}, ${SUB_END}, ARRAY[3]::int[], '09:00:00', '18:00:00', now())
      `);
      await tx.execute(sqlTag`
        INSERT INTO tasks (
          id, tenant_id, consignee_id, subscription_id, created_via,
          customer_order_number, internal_status, delivery_date,
          delivery_start_time, delivery_end_time, address_id,
          external_id, external_tracking_number, pushed_to_external_at, outbound_sync_state
        ) VALUES
          (${TASK_UNPUSHED}, ${TENANT}, ${CONSIGNEE}, ${SUB_ACTIVE}, 'subscription',
           ${`CH-${RUN_ID}-U`}, 'CREATED', ${WED_1}, '09:00:00', '18:00:00', ${ADDRESS},
           NULL, NULL, NULL, 'pending'),
          (${TASK_PUSHED}, ${TENANT}, ${CONSIGNEE}, ${SUB_ACTIVE}, 'subscription',
           ${`CH-${RUN_ID}-P`}, 'CREATED', ${WED_2}, '09:00:00', '18:00:00', ${ADDRESS},
           ${`ext-${RUN_ID}-1`}, ${AWB_PUSHED}, now(), 'synced'),
          (${TASK_ASSIGNED}, ${TENANT}, ${CONSIGNEE}, ${SUB_PAUSED}, 'subscription',
           ${`CH-${RUN_ID}-A`}, 'ASSIGNED', ${WED_1}, '09:00:00', '18:00:00', ${ADDRESS},
           ${`ext-${RUN_ID}-2`}, ${AWB_ASSIGNED}, now(), 'synced'),
          (${TASK_DELIVERED}, ${TENANT}, ${CONSIGNEE}, ${SUB_ACTIVE}, 'subscription',
           ${`CH-${RUN_ID}-D`}, 'DELIVERED', ${WED_3}, '09:00:00', '18:00:00', ${ADDRESS},
           ${`ext-${RUN_ID}-3`}, ${`CHURN-${RUN_ID}-D`}, now(), 'synced')
      `);
    });
  });

  it("case 1 — CHURNED: subs end, unpushed cancels locally, pushed (incl. ASSIGNED) recalled with status preserved, audit counts honest", async () => {
    const result = await changeConsigneeCrmState(ctxFor(), CONSIGNEE, {
      toState: "CHURNED",
      reason: "customer churned — hard stop",
    });
    expect(result.status).toBe("updated");

    // Subscriptions: both ended.
    const subs = await withServiceRole("churn read subs", async (tx) => {
      return (await tx.execute(sqlTag`
        SELECT id, status FROM subscriptions WHERE consignee_id = ${CONSIGNEE}
      `)) as readonly { id: string; status: string }[];
    });
    expect(subs.every((s) => s.status === "ended")).toBe(true);

    // Tasks: honesty split.
    expect((await readTask(TASK_UNPUSHED)).internal_status).toBe("CANCELED");
    const pushed = await readTask(TASK_PUSHED);
    expect(pushed.internal_status).toBe("CREATED"); // NOT flipped — vendor not yet confirmed
    expect(pushed.outbound_sync_state).toBe("pending_cancel");
    const assigned = await readTask(TASK_ASSIGNED);
    expect(assigned.internal_status).toBe("ASSIGNED"); // honesty: still in driver hands
    expect(assigned.outbound_sync_state).toBe("pending_cancel");
    const delivered = await readTask(TASK_DELIVERED);
    expect(delivered.internal_status).toBe("DELIVERED"); // terminal untouched
    expect(delivered.outbound_sync_state).toBe("synced");

    // Fan-out: exactly the two recall AWBs.
    expect(enqueueBulkCancelTasksSpy).toHaveBeenCalledTimes(1);
    const payloads = enqueueBulkCancelTasksSpy.mock.calls[0][0] as readonly { awb: string }[];
    expect(payloads.map((pl) => pl.awb).sort()).toEqual([AWB_ASSIGNED, AWB_PUSHED].sort());

    // Audit: churn_cascade with honest counts.
    const events = await withServiceRole("churn read audit", async (tx) => {
      return (await tx.execute(sqlTag`
        SELECT metadata FROM audit_events
        WHERE event_type = 'consignee.churn_cascade'
          AND tenant_id = ${TENANT} AND resource_id = ${CONSIGNEE}
      `)) as readonly { metadata: Record<string, unknown> }[];
    });
    expect(events.length).toBe(1);
    expect(events[0].metadata.subscriptions_ended).toBe(2);
    expect(events[0].metadata.tasks_canceled_local).toBe(1);
    expect(events[0].metadata.recalls_attempted).toBe(2);
  });

  it("case 2 — guard: a non-churn transition cascades nothing", async () => {
    enqueueBulkCancelTasksSpy.mockClear();

    const result = await changeConsigneeCrmState(ctxFor(), CONSIGNEE_2, {
      toState: "ON_HOLD",
      reason: "short hold",
    });
    expect(result.status).toBe("updated");
    expect(enqueueBulkCancelTasksSpy).not.toHaveBeenCalled();

    const events = await withServiceRole("churn guard audit", async (tx) => {
      return (await tx.execute(sqlTag`
        SELECT id FROM audit_events
        WHERE event_type = 'consignee.churn_cascade'
          AND tenant_id = ${TENANT} AND resource_id = ${CONSIGNEE_2}
      `)) as readonly { id: string }[];
    });
    expect(events.length).toBe(0);
  });
});
