// tests/integration/ra-assignment-gate.spec.ts
// =============================================================================
// Day-54 R-A — assignment gate on real Postgres.
// Plan: memory/plans/day-54-session-c-ra-assignment-gate.md §5.
//
// Cases pinned:
//   1. Pause over a mixed window (CREATED + ASSIGNED): subscription
//      pauses, the CREATED task cancels, the ASSIGNED task survives
//      untouched, and subscription.paused's metadata carries
//      assigned_tasks_excluded = 1. The pause_start is deliberately
//      PAST the 18:00 cut-off (creation-only rule — the pause time
//      gate is gone).
//   2. Skip on a driver-bound date: rejected with the locked message
//      and the exception INSERT rolled back (no row).
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("../../src/modules/task-outbound-queue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/modules/task-outbound-queue")>();
  return {
    ...actual,
    enqueueBulkCancelTasks: vi.fn(async (payloads: readonly unknown[]) => ({
      enqueuedCount: payloads.length,
      failedChunks: 0,
      totalCount: payloads.length,
    })),
    enqueueCancelTask: vi.fn(async () => ({ enqueued: true })),
  };
});

import { withServiceRole, withTenant } from "../../src/shared/db";
import type { RequestContext } from "../../src/shared/tenant-context";
import type { Uuid } from "../../src/shared/types";

import { ALL_PERMISSION_IDS } from "../../src/modules/identity/permissions";
import { addSubscriptionException } from "../../src/modules/subscription-exceptions/service";
import { pauseSubscription } from "../../src/modules/subscriptions/service";

const RUN_ID = randomUUID().slice(0, 8);
const TENANT = randomUUID() as Uuid;
const SLUG = `ra-${RUN_ID}`;
const USER = randomUUID() as Uuid;
const CONSIGNEE = randomUUID() as Uuid;
const ADDRESS = randomUUID() as Uuid;
const SUB = randomUUID() as Uuid;
const SUB2 = randomUUID() as Uuid; // case 2 — stays active

const TASK_CREATED = randomUUID() as Uuid;
const TASK_ASSIGNED = randomUUID() as Uuid;
const TASK_ASSIGNED_2 = randomUUID() as Uuid;

// Two consecutive Wednesdays, far future.
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

function ctxFor(): RequestContext {
  return {
    actor: {
      kind: "user",
      userId: USER,
      tenantId: TENANT,
      permissions: new Set(ALL_PERMISSION_IDS) as unknown as Set<never>,
      email: `${USER}@ra.example`,
      displayName: null,
    },
    tenantId: TENANT,
    requestId: `req-${RUN_ID}`,
    path: "/api/test",
  };
}

async function readTaskStatus(taskId: Uuid): Promise<string> {
  return withTenant(TENANT, async (tx) => {
    const rows = (await tx.execute(sqlTag`
      SELECT internal_status FROM tasks WHERE id = ${taskId}
    `)) as readonly { internal_status: string }[];
    return rows[0].internal_status;
  });
}

describe("Day-54 R-A — assignment gate (real Postgres)", () => {
  beforeAll(async () => {
    await withServiceRole("ra seed base", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, status)
        VALUES (${TENANT}, ${SLUG}, 'R-A Test', 'active')
      `);
      await tx.execute(sqlTag`
        INSERT INTO roles (tenant_id, name, slug, description) VALUES
          (NULL, 'Tenant Admin', 'tenant-admin', 'ra seed')
        ON CONFLICT (tenant_id, slug) DO NOTHING
      `);
      await tx.execute(sqlTag`
        INSERT INTO auth.users (id, email) VALUES (${USER}, ${USER + "@ra.example"})
      `);
      await tx.execute(sqlTag`
        INSERT INTO users (id, tenant_id, email)
        VALUES (${USER}, ${TENANT}, ${USER + "@ra.example"})
      `);
      await tx.execute(sqlTag`
        INSERT INTO role_assignments (user_id, role_id, tenant_id)
        SELECT ${USER}, r.id, ${TENANT} FROM roles r
        WHERE r.tenant_id IS NULL AND r.slug = 'tenant-admin'
      `);
      await tx.execute(sqlTag`
        INSERT INTO consignees (id, tenant_id, name, email, phone,
          address_line, emirate_or_region, district)
        VALUES (${CONSIGNEE}, ${TENANT}, 'R-A Consignee', 'cons@ra.test',
                '+971500000096', 'Test Line', 'Dubai', 'Test District')
      `);
      await tx.execute(sqlTag`
        INSERT INTO addresses (id, tenant_id, consignee_id, label, is_primary, line, district, emirate)
        VALUES (${ADDRESS}, ${TENANT}, ${CONSIGNEE},
                'home', true, 'Test Line', 'Test District', 'Dubai')
      `);
      await tx.execute(sqlTag`
        INSERT INTO subscriptions (id, tenant_id, consignee_id, status, start_date, end_date,
          days_of_week, delivery_window_start, delivery_window_end)
        VALUES (${SUB}, ${TENANT}, ${CONSIGNEE}, 'active',
          ${WED_1}, ${SUB_END}, ARRAY[3]::int[], '09:00:00', '18:00:00')
      `);
      await tx.execute(sqlTag`
        INSERT INTO subscriptions (id, tenant_id, consignee_id, status, start_date, end_date,
          days_of_week, delivery_window_start, delivery_window_end)
        VALUES (${SUB2}, ${TENANT}, ${CONSIGNEE}, 'active',
          ${WED_1}, ${SUB_END}, ARRAY[3]::int[], '09:00:00', '18:00:00')
      `);
      await tx.execute(sqlTag`
        INSERT INTO tasks (
          id, tenant_id, consignee_id, subscription_id, created_via,
          customer_order_number, internal_status, delivery_date,
          delivery_start_time, delivery_end_time, address_id
        ) VALUES
          (${TASK_CREATED}, ${TENANT}, ${CONSIGNEE}, ${SUB}, 'subscription',
           ${`RA-${RUN_ID}-C`}, 'CREATED', ${WED_1}, '09:00:00', '18:00:00', ${ADDRESS}),
          (${TASK_ASSIGNED}, ${TENANT}, ${CONSIGNEE}, ${SUB}, 'subscription',
           ${`RA-${RUN_ID}-A`}, 'ASSIGNED', ${WED_2}, '09:00:00', '18:00:00', ${ADDRESS}),
          (${TASK_ASSIGNED_2}, ${TENANT}, ${CONSIGNEE}, ${SUB2}, 'subscription',
           ${`RA-${RUN_ID}-A2`}, 'ASSIGNED', ${WED_2}, '09:00:00', '18:00:00', ${ADDRESS})
      `);
    });
  });

  it("case 1 — pause over a mixed window: ASSIGNED survives, CREATED cancels, excluded count audited; post-cutoff start accepted", async () => {
    // pause_start = today: its 18:00-day-before cut-off has ALWAYS
    // elapsed — this very call rejected before R-A.
    const today = new Date().toISOString().slice(0, 10);
    const result = await pauseSubscription(ctxFor(), SUB, {
      pause_start: today,
      pause_end: nextWedAfter(44),
      idempotency_key: randomUUID(),
    });
    expect(result.status).toBe("inserted");
    expect(result.canceled_task_count).toBe(1);

    expect(await readTaskStatus(TASK_CREATED)).toBe("CANCELED");
    expect(await readTaskStatus(TASK_ASSIGNED)).toBe("ASSIGNED"); // frozen — delivery proceeds

    const events = await withServiceRole("ra read paused audit", async (tx) => {
      return (await tx.execute(sqlTag`
        SELECT metadata FROM audit_events
        WHERE event_type = 'subscription.paused'
          AND tenant_id = ${TENANT} AND resource_id = ${SUB}
        ORDER BY occurred_at DESC
      `)) as readonly { metadata: Record<string, unknown> }[];
    });
    expect(events.length).toBe(1);
    expect(events[0].metadata.assigned_tasks_excluded).toBe(1);
    expect(events[0].metadata.canceled_task_count).toBe(1);
  });

  it("case 2 — skip on a driver-bound date rejects with the locked message and rolls back the exception row", async () => {
    await expect(
      addSubscriptionException(ctxFor(), SUB2, {
        type: "skip",
        date: WED_2,
        idempotencyKey: randomUUID() as never,
      } as never),
    ).rejects.toThrow(/assigned to a driver/i);

    const rows = await withServiceRole("ra exception count", async (tx) => {
      return (await tx.execute(sqlTag`
        SELECT id FROM subscription_exceptions
        WHERE subscription_id = ${SUB2} AND type = 'skip'
      `)) as readonly { id: string }[];
    });
    expect(rows.length).toBe(0);
    expect(await readTaskStatus(TASK_ASSIGNED_2)).toBe("ASSIGNED");
  });
});
