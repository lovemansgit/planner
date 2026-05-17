// tests/integration/subscription-exceptions/skip-outbound.spec.ts
// =============================================================================
// Day-29 §D(2) Phase-1 — service-layer skip→SF outbound enqueue tests
// per plan-PR #302 §8.2 (cases 1, 2, 4-8). Variant 3 (move-to-date) is
// Phase 2 territory; this file asserts that Phase 1 does NOT enqueue
// for variant 3.
//
// Mocks `@/modules/task-outbound-queue/publish` for observability of
// enqueueCancelTask invocation per variant. All other dependencies
// (tx, audit, DB) run against real postgres-js. Mirrors the mock
// pattern at tests/integration/cron-decoupling-happy-path.spec.ts:83-87.
//
// Self-contained — own tenant/user/subscription/task seed; does not
// share state with sibling service.spec.ts.
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Mock the publisher at module level so we can spy + override per test.
// Hoisted spies so the imports below see the mocked module.
const enqueueCancelTaskSpy = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../../../src/modules/task-outbound-queue/publish", () => ({
  enqueueCancelTask: enqueueCancelTaskSpy,
  // Other exports preserved as no-op spies — service.ts only imports
  // enqueueCancelTask for the skip path, but the barrel re-export pulls
  // the whole module so we have to satisfy the surface.
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

// Imports AFTER mock so the service picks up the spy.
import { withServiceRole, withTenant } from "../../../src/shared/db";
import type { RequestContext } from "../../../src/shared/tenant-context";
import type { Uuid } from "../../../src/shared/types";

import { addSubscriptionException } from "../../../src/modules/subscription-exceptions";
import { ALL_PERMISSION_IDS } from "../../../src/modules/identity/permissions";

const RUN_ID = randomUUID().slice(0, 8);

const TENANT = randomUUID() as Uuid;
const SLUG = `d29-skip-outbound-${RUN_ID}`;
const USER = randomUUID() as Uuid;
const CONSIGNEE = randomUUID() as Uuid;
const ADDRESS = randomUUID() as Uuid;
const SUBSCRIPTION = randomUUID() as Uuid;

// Task IDs per variant fixture
const TASK_MATERIALIZED_PUSHED = randomUUID() as Uuid;
const TASK_MATERIALIZED_UNPUSHED = randomUUID() as Uuid;
const TASK_FOR_SKIP_WITHOUT_APPEND = randomUUID() as Uuid;
const TASK_FOR_IDEMPOTENT_REPLAY = randomUUID() as Uuid;
const TASK_FOR_PUBLISHER_THROW = randomUUID() as Uuid;

const TRACKING_NUMBER_PUSHED = `AWB-D29-${RUN_ID}-PUSHED`;
const TRACKING_NUMBER_SKIPWITHOUT = `AWB-D29-${RUN_ID}-SKIPWITHOUT`;
const TRACKING_NUMBER_REPLAY = `AWB-D29-${RUN_ID}-REPLAY`;
const TRACKING_NUMBER_THROW = `AWB-D29-${RUN_ID}-THROW`;

// Pick a Wednesday far in the future (clear of 18:00-Dubai cut-off).
// Pre-compute distinct dates for each test case so seeds don't collide.
function nextWedAfter(daysOffset: number): string {
  const dt = new Date(Date.now() + daysOffset * 24 * 60 * 60 * 1000);
  const day = dt.getUTCDay();
  const wedDelta = ((3 - day + 7) % 7) || 7;
  dt.setUTCDate(dt.getUTCDate() + wedDelta);
  return dt.toISOString().slice(0, 10);
}

const DATE_PLAIN_SKIP = nextWedAfter(40);
const DATE_SKIP_WITHOUT_APPEND = nextWedAfter(50);
const DATE_UNMATERIALIZED = nextWedAfter(60);
const DATE_UNPUSHED = nextWedAfter(70);
const DATE_REPLAY = nextWedAfter(80);
const DATE_PUBLISHER_THROW = nextWedAfter(90);
const SUBSCRIPTION_END = nextWedAfter(120); // past all test dates

function ctxFor(): RequestContext {
  return {
    actor: {
      kind: "user",
      userId: USER,
      tenantId: TENANT,
      permissions: new Set(ALL_PERMISSION_IDS) as unknown as Set<never>,
      email: `${USER}@d29-skip-outbound.example`,
      displayName: null,
    },
    tenantId: TENANT,
    requestId: `req-${RUN_ID}`,
    path: "/api/test",
  };
}

describe("Day-29 §D(2) Phase-1 — skip→SF outbound enqueue (variants 1+2)", () => {
  beforeAll(async () => {
    await withServiceRole("d29-skip-outbound seed", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, status)
        VALUES (${TENANT}, ${SLUG}, 'D29 Skip Outbound Test Tenant', 'active')
      `);

      await tx.execute(sqlTag`
        INSERT INTO roles (tenant_id, name, slug, description) VALUES
          (NULL, 'Tenant Admin', 'tenant-admin', 'd29 skip outbound seed')
        ON CONFLICT (tenant_id, slug) DO NOTHING
      `);

      await tx.execute(sqlTag`
        INSERT INTO auth.users (id, email)
        VALUES (${USER}, ${USER + "@d29-skip-outbound.example"})
      `);
      await tx.execute(sqlTag`
        INSERT INTO users (id, tenant_id, email)
        VALUES (${USER}, ${TENANT}, ${USER + "@d29-skip-outbound.example"})
      `);
      await tx.execute(sqlTag`
        INSERT INTO role_assignments (user_id, role_id, tenant_id)
        SELECT ${USER}, r.id, ${TENANT} FROM roles r
        WHERE r.tenant_id IS NULL AND r.slug = 'tenant-admin'
      `);

      await tx.execute(sqlTag`
        INSERT INTO consignees (
          id, tenant_id, name, email, phone,
          address_line, emirate_or_region, district
        ) VALUES (${CONSIGNEE}, ${TENANT}, 'D29 Skip Test Consignee', 'cons@d29.test',
                  '+971500000099', 'Test Line', 'Dubai', 'Test District')
      `);

      await tx.execute(sqlTag`
        INSERT INTO addresses (id, tenant_id, consignee_id, label, is_primary, line, district, emirate)
        VALUES (${ADDRESS}, ${TENANT}, ${CONSIGNEE},
                'home', true, 'Test Line', 'Test District', 'Dubai')
      `);

      // Subscription days_of_week: Wed-only (3) so all our test dates qualify.
      await tx.execute(sqlTag`
        INSERT INTO subscriptions (
          id, tenant_id, consignee_id, status, start_date, end_date,
          days_of_week, delivery_window_start, delivery_window_end
        ) VALUES (
          ${SUBSCRIPTION}, ${TENANT}, ${CONSIGNEE}, 'active',
          ${DATE_PLAIN_SKIP}, ${SUBSCRIPTION_END},
          ARRAY[3]::int[], '09:00:00', '18:00:00'
        )
      `);

      // Seed tasks per test variant. external_tracking_number set on
      // pushed tasks, null on unpushed. internal_status='CREATED' so the
      // markTaskSkipped UPDATE filter accepts them.
      await tx.execute(sqlTag`
        INSERT INTO tasks (
          id, tenant_id, consignee_id, subscription_id, created_via,
          customer_order_number, internal_status, external_tracking_number,
          delivery_date, delivery_start_time, delivery_end_time,
          address_id, pushed_to_external_at
        ) VALUES
          (${TASK_MATERIALIZED_PUSHED}, ${TENANT}, ${CONSIGNEE}, ${SUBSCRIPTION}, 'subscription',
           'ORD-PLAIN', 'CREATED', ${TRACKING_NUMBER_PUSHED},
           ${DATE_PLAIN_SKIP}, '09:00:00', '18:00:00',
           ${ADDRESS}, now()),
          (${TASK_FOR_SKIP_WITHOUT_APPEND}, ${TENANT}, ${CONSIGNEE}, ${SUBSCRIPTION}, 'subscription',
           'ORD-SWA', 'CREATED', ${TRACKING_NUMBER_SKIPWITHOUT},
           ${DATE_SKIP_WITHOUT_APPEND}, '09:00:00', '18:00:00',
           ${ADDRESS}, now()),
          (${TASK_MATERIALIZED_UNPUSHED}, ${TENANT}, ${CONSIGNEE}, ${SUBSCRIPTION}, 'subscription',
           'ORD-UNPUSHED', 'CREATED', NULL,
           ${DATE_UNPUSHED}, '09:00:00', '18:00:00',
           ${ADDRESS}, NULL),
          (${TASK_FOR_IDEMPOTENT_REPLAY}, ${TENANT}, ${CONSIGNEE}, ${SUBSCRIPTION}, 'subscription',
           'ORD-REPLAY', 'CREATED', ${TRACKING_NUMBER_REPLAY},
           ${DATE_REPLAY}, '09:00:00', '18:00:00',
           ${ADDRESS}, now()),
          (${TASK_FOR_PUBLISHER_THROW}, ${TENANT}, ${CONSIGNEE}, ${SUBSCRIPTION}, 'subscription',
           'ORD-THROW', 'CREATED', ${TRACKING_NUMBER_THROW},
           ${DATE_PUBLISHER_THROW}, '09:00:00', '18:00:00',
           ${ADDRESS}, now())
      `);
    });
  });

  beforeEach(() => {
    // Reset spy state + restore default impl. Per-test mockImplementationOnce
    // overrides cover the publisher-throws case.
    enqueueCancelTaskSpy.mockReset();
    enqueueCancelTaskSpy.mockImplementation(async () => undefined);
  });

  // §8.2 case 1
  it("variant 1 (plain skip) on materialized+pushed task: enqueueCancelTask called once with correlation_id from exception row", async () => {
    const result = await addSubscriptionException(ctxFor(), SUBSCRIPTION, {
      type: "skip",
      date: DATE_PLAIN_SKIP,
      idempotencyKey: randomUUID() as Uuid,
    });

    expect(result.status).toBe("inserted");
    expect(enqueueCancelTaskSpy).toHaveBeenCalledTimes(1);
    expect(enqueueCancelTaskSpy).toHaveBeenCalledWith({
      tenant_id: TENANT,
      task_id: TASK_MATERIALIZED_PUSHED,
      awb: TRACKING_NUMBER_PUSHED,
      correlation_id: result.correlationId,
    });

    // Task should have flipped to outbound_sync_state='pending_cancel'
    // alongside internal_status='SKIPPED' inside the tx.
    await withTenant(TENANT, async (tx) => {
      type Row = { internal_status: string; outbound_sync_state: string };
      const rows = (await tx.execute(sqlTag`
        SELECT internal_status, outbound_sync_state
        FROM tasks WHERE id = ${TASK_MATERIALIZED_PUSHED}
      `)) as readonly Row[];
      expect(rows[0].internal_status).toBe("SKIPPED");
      expect(rows[0].outbound_sync_state).toBe("pending_cancel");
    });

    // §8.2 case 8 — audit correlation_id matches publisher payload correlation_id.
    await withServiceRole("d29-skip-outbound audit correlation check", async (tx) => {
      type Row = {
        event_type: string;
        metadata: {
          correlation_id?: string;
          outbound_emission?: { kind: string; task_id?: string };
        };
      };
      const rows = (await tx.execute(sqlTag`
        SELECT event_type, metadata
        FROM audit_events
        WHERE metadata->>'correlation_id' = ${result.correlationId}
      `)) as readonly Row[];
      const createdEvent = rows.find((r) => r.event_type === "subscription.exception.created");
      expect(createdEvent).toBeDefined();
      expect(createdEvent?.metadata.outbound_emission).toEqual({
        kind: "cancel",
        task_id: TASK_MATERIALIZED_PUSHED,
      });
    });
  });

  // §8.2 case 2
  it("variant 2 (skip-without-append) on materialized+pushed task: enqueueCancelTask called once; end_date unchanged", async () => {
    const subBefore = await withTenant(TENANT, async (tx) => {
      type Row = { end_date: string };
      const rows = (await tx.execute(sqlTag`
        SELECT end_date FROM subscriptions WHERE id = ${SUBSCRIPTION}
      `)) as readonly Row[];
      return rows[0].end_date;
    });

    const result = await addSubscriptionException(ctxFor(), SUBSCRIPTION, {
      type: "skip",
      date: DATE_SKIP_WITHOUT_APPEND,
      idempotencyKey: randomUUID() as Uuid,
      skipWithoutAppend: true,
    });

    expect(result.status).toBe("inserted");
    expect(result.compensatingDate).toBeNull();
    expect(result.newEndDate).toBeNull();

    expect(enqueueCancelTaskSpy).toHaveBeenCalledTimes(1);
    expect(enqueueCancelTaskSpy).toHaveBeenCalledWith({
      tenant_id: TENANT,
      task_id: TASK_FOR_SKIP_WITHOUT_APPEND,
      awb: TRACKING_NUMBER_SKIPWITHOUT,
      correlation_id: result.correlationId,
    });

    const subAfter = await withTenant(TENANT, async (tx) => {
      type Row = { end_date: string };
      const rows = (await tx.execute(sqlTag`
        SELECT end_date FROM subscriptions WHERE id = ${SUBSCRIPTION}
      `)) as readonly Row[];
      return rows[0].end_date;
    });
    expect(subAfter).toBe(subBefore);
  });

  // §8.2 case 4
  it("skip on UNMATERIALIZED date (no task row exists): no publisher called (sub-case 13a)", async () => {
    const result = await addSubscriptionException(ctxFor(), SUBSCRIPTION, {
      type: "skip",
      date: DATE_UNMATERIALIZED,
      idempotencyKey: randomUUID() as Uuid,
    });

    expect(result.status).toBe("inserted");
    expect(enqueueCancelTaskSpy).not.toHaveBeenCalled();

    // Audit metadata.outbound_emission should be { kind: 'none' }.
    await withServiceRole("d29-skip-outbound unmaterialized audit", async (tx) => {
      type Row = { metadata: { outbound_emission?: { kind: string } } };
      const rows = (await tx.execute(sqlTag`
        SELECT metadata
        FROM audit_events
        WHERE event_type = 'subscription.exception.created'
          AND metadata->>'correlation_id' = ${result.correlationId}
      `)) as readonly Row[];
      expect(rows[0].metadata.outbound_emission).toEqual({ kind: "none" });
    });
  });

  // §8.2 case 5
  it("skip on materialized-but-never-pushed task (external_tracking_number IS NULL): no publisher called", async () => {
    const result = await addSubscriptionException(ctxFor(), SUBSCRIPTION, {
      type: "skip",
      date: DATE_UNPUSHED,
      idempotencyKey: randomUUID() as Uuid,
    });

    expect(result.status).toBe("inserted");
    expect(enqueueCancelTaskSpy).not.toHaveBeenCalled();

    // Task SHOULD still be SKIPPED locally; outbound_sync_state stays 'synced'
    // because the CASE expression in markTaskSkipped only sets 'pending_cancel'
    // when external_tracking_number IS NOT NULL.
    await withTenant(TENANT, async (tx) => {
      type Row = { internal_status: string; outbound_sync_state: string };
      const rows = (await tx.execute(sqlTag`
        SELECT internal_status, outbound_sync_state
        FROM tasks WHERE id = ${TASK_MATERIALIZED_UNPUSHED}
      `)) as readonly Row[];
      expect(rows[0].internal_status).toBe("SKIPPED");
      expect(rows[0].outbound_sync_state).toBe("synced");
    });
  });

  // §8.2 case 6
  it("idempotent replay (same idempotency_key) does not re-enqueue", async () => {
    const idempotencyKey = randomUUID() as Uuid;

    const first = await addSubscriptionException(ctxFor(), SUBSCRIPTION, {
      type: "skip",
      date: DATE_REPLAY,
      idempotencyKey,
    });
    expect(first.status).toBe("inserted");
    expect(enqueueCancelTaskSpy).toHaveBeenCalledTimes(1);

    const second = await addSubscriptionException(ctxFor(), SUBSCRIPTION, {
      type: "skip",
      date: DATE_REPLAY,
      idempotencyKey,
    });
    expect(second.status).toBe("idempotent_replay");
    expect(second.httpStatus).toBe(409);
    expect(second.exceptionId).toBe(first.exceptionId);
    // Publisher should still have been called exactly once total.
    expect(enqueueCancelTaskSpy).toHaveBeenCalledTimes(1);
  });

  // §8.2 case 7
  it("publisher throws → service throws → local DB stays committed (exception row + task SKIPPED)", async () => {
    enqueueCancelTaskSpy.mockImplementationOnce(async () => {
      throw new Error("QStash publish failed (test injected)");
    });

    const idempotencyKey = randomUUID() as Uuid;

    await expect(
      addSubscriptionException(ctxFor(), SUBSCRIPTION, {
        type: "skip",
        date: DATE_PUBLISHER_THROW,
        idempotencyKey,
      }),
    ).rejects.toThrow(/QStash publish failed/);

    // Local DB MUST still have the exception row + the task in SKIPPED
    // state with outbound_sync_state='pending_cancel'. The form action
    // surfaces "saved locally; SF push pending" semantics; ops can
    // triage from the pending state.
    await withTenant(TENANT, async (tx) => {
      type ExceptionRow = { id: string; idempotency_key: string };
      const exceptions = (await tx.execute(sqlTag`
        SELECT id, idempotency_key
        FROM subscription_exceptions
        WHERE subscription_id = ${SUBSCRIPTION}
          AND idempotency_key = ${idempotencyKey}
      `)) as readonly ExceptionRow[];
      expect(exceptions.length).toBe(1);

      type TaskRow = { internal_status: string; outbound_sync_state: string };
      const tasks = (await tx.execute(sqlTag`
        SELECT internal_status, outbound_sync_state
        FROM tasks WHERE id = ${TASK_FOR_PUBLISHER_THROW}
      `)) as readonly TaskRow[];
      expect(tasks[0].internal_status).toBe("SKIPPED");
      expect(tasks[0].outbound_sync_state).toBe("pending_cancel");
    });
  });
});
