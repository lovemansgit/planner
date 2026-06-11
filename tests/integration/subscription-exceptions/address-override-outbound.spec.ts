// tests/integration/subscription-exceptions/address-override-outbound.spec.ts
// =============================================================================
// Day-52 R4 (plan-PR #335 §2.R4) — one-off address override → task
// backfill + SF outbound enqueue. Real-Postgres integration per the
// schema-drift discipline; mirrors the sibling skip-outbound.spec.ts
// harness (publisher mocked for observability, everything else real).
//
// Cases pinned:
//   1. Override on materialized+PUSHED task: tasks.address_id updated in
//      the same tx as the exception row; outbound_sync_state flips to
//      'pending_update' (migration 0029); enqueueUpdateTask called once
//      with the SERVER-BUILT ConsigneeSnapshot (R4 option B) and the
//      exception row's correlation_id; typed task.address_override_pushed
//      audit event emitted with the same correlation_id.
//   2. Override on materialized+UNPUSHED task: address updated locally;
//      sync state unchanged ('pending'); NO enqueue; NO typed event.
//   3. Override on UNMATERIALIZED date: exception row durable (the
//      materializer CTE one-off branch applies it later); NO task
//      UPDATE; NO enqueue.
//   4. Publisher throws: local DB stays committed (new address_id +
//      'pending_update'); service re-throws; NO typed event (R3
//      emit-then-throw precedent — the event fires only on successful
//      enqueue).
//   5. Idempotent replay: same idempotency_key → 409 replay, publisher
//      called exactly once total.
//   6. Date whose only task is SKIPPED: repo status-filter excludes it →
//      treated as unmaterialized (exception row only; task untouched).
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const enqueueUpdateTaskSpy = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../../../src/modules/task-outbound-queue/publish", () => ({
  enqueueCancelTask: vi.fn(async () => undefined),
  enqueueUpdateTask: enqueueUpdateTaskSpy,
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

import { withServiceRole, withTenant } from "../../../src/shared/db";
import type { RequestContext } from "../../../src/shared/tenant-context";
import type { Uuid } from "../../../src/shared/types";

import { addSubscriptionException } from "../../../src/modules/subscription-exceptions";
import { ALL_PERMISSION_IDS } from "../../../src/modules/identity/permissions";

const RUN_ID = randomUUID().slice(0, 8);

const TENANT = randomUUID() as Uuid;
const SLUG = `d52-r4-override-${RUN_ID}`;
const USER = randomUUID() as Uuid;
const CONSIGNEE = randomUUID() as Uuid;
const ADDRESS_PRIMARY = randomUUID() as Uuid;
const ADDRESS_OVERRIDE = randomUUID() as Uuid;
const SUBSCRIPTION = randomUUID() as Uuid;

const TASK_PUSHED = randomUUID() as Uuid;
const TASK_UNPUSHED = randomUUID() as Uuid;
const TASK_REPLAY = randomUUID() as Uuid;
const TASK_PUBLISHER_THROW = randomUUID() as Uuid;
const TASK_SKIPPED = randomUUID() as Uuid;

const AWB_PUSHED = `AWB-R4-${RUN_ID}-PUSHED`;
const AWB_REPLAY = `AWB-R4-${RUN_ID}-REPLAY`;
const AWB_THROW = `AWB-R4-${RUN_ID}-THROW`;
const AWB_SKIPPED = `AWB-R4-${RUN_ID}-SKIPPED`;

function nextWedAfter(daysOffset: number): string {
  const dt = new Date(Date.now() + daysOffset * 24 * 60 * 60 * 1000);
  const day = dt.getUTCDay();
  const wedDelta = ((3 - day + 7) % 7) || 7;
  dt.setUTCDate(dt.getUTCDate() + wedDelta);
  return dt.toISOString().slice(0, 10);
}

const DATE_PUSHED = nextWedAfter(40);
const DATE_UNPUSHED = nextWedAfter(50);
const DATE_UNMATERIALIZED = nextWedAfter(60);
const DATE_REPLAY = nextWedAfter(70);
const DATE_PUBLISHER_THROW = nextWedAfter(80);
const DATE_SKIPPED = nextWedAfter(90);
const SUBSCRIPTION_END = nextWedAfter(120);

function ctxFor(): RequestContext {
  return {
    actor: {
      kind: "user",
      userId: USER,
      tenantId: TENANT,
      permissions: new Set(ALL_PERMISSION_IDS) as unknown as Set<never>,
      email: `${USER}@d52-r4.example`,
      displayName: null,
    },
    tenantId: TENANT,
    requestId: `req-${RUN_ID}`,
    path: "/api/test",
  };
}

const EXPECTED_SNAPSHOT = {
  name: "R4 Override Consignee",
  contactPhone: "+971500000412",
  address: {
    addressLine1: "Villa 9, Palm West",
    city: "Dubai",
    district: "Palm Jumeirah",
    countryCode: "AE",
  },
};

describe("Day-52 R4 — one-off address override → backfill + SF outbound enqueue", () => {
  beforeAll(async () => {
    await withServiceRole("d52-r4 override seed", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, status)
        VALUES (${TENANT}, ${SLUG}, 'D52 R4 Override Test Tenant', 'active')
      `);

      await tx.execute(sqlTag`
        INSERT INTO roles (tenant_id, name, slug, description) VALUES
          (NULL, 'Tenant Admin', 'tenant-admin', 'd52 r4 seed')
        ON CONFLICT (tenant_id, slug) DO NOTHING
      `);

      await tx.execute(sqlTag`
        INSERT INTO auth.users (id, email)
        VALUES (${USER}, ${USER + "@d52-r4.example"})
      `);
      await tx.execute(sqlTag`
        INSERT INTO users (id, tenant_id, email)
        VALUES (${USER}, ${TENANT}, ${USER + "@d52-r4.example"})
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
        ) VALUES (${CONSIGNEE}, ${TENANT}, 'R4 Override Consignee', 'cons@d52-r4.test',
                  '+971500000412', 'Old Line', 'Dubai', 'Old District')
      `);

      await tx.execute(sqlTag`
        INSERT INTO addresses (id, tenant_id, consignee_id, label, is_primary, line, district, emirate)
        VALUES
          (${ADDRESS_PRIMARY}, ${TENANT}, ${CONSIGNEE},
           'home', true, 'Old Line', 'Old District', 'Dubai'),
          (${ADDRESS_OVERRIDE}, ${TENANT}, ${CONSIGNEE},
           'office', false, 'Villa 9, Palm West', 'Palm Jumeirah', 'Dubai')
      `);

      await tx.execute(sqlTag`
        INSERT INTO subscriptions (
          id, tenant_id, consignee_id, status, start_date, end_date,
          days_of_week, delivery_window_start, delivery_window_end
        ) VALUES (
          ${SUBSCRIPTION}, ${TENANT}, ${CONSIGNEE}, 'active',
          ${DATE_PUSHED}, ${SUBSCRIPTION_END},
          ARRAY[3]::int[], '09:00:00', '18:00:00'
        )
      `);

      await tx.execute(sqlTag`
        INSERT INTO tasks (
          id, tenant_id, consignee_id, subscription_id, created_via,
          customer_order_number, internal_status, external_tracking_number,
          delivery_date, delivery_start_time, delivery_end_time,
          address_id, pushed_to_external_at
        ) VALUES
          (${TASK_PUSHED}, ${TENANT}, ${CONSIGNEE}, ${SUBSCRIPTION}, 'subscription',
           'ORD-R4-PUSHED', 'CREATED', ${AWB_PUSHED},
           ${DATE_PUSHED}, '09:00:00', '18:00:00',
           ${ADDRESS_PRIMARY}, now()),
          (${TASK_UNPUSHED}, ${TENANT}, ${CONSIGNEE}, ${SUBSCRIPTION}, 'subscription',
           'ORD-R4-UNPUSHED', 'CREATED', NULL,
           ${DATE_UNPUSHED}, '09:00:00', '18:00:00',
           ${ADDRESS_PRIMARY}, NULL),
          (${TASK_REPLAY}, ${TENANT}, ${CONSIGNEE}, ${SUBSCRIPTION}, 'subscription',
           'ORD-R4-REPLAY', 'CREATED', ${AWB_REPLAY},
           ${DATE_REPLAY}, '09:00:00', '18:00:00',
           ${ADDRESS_PRIMARY}, now()),
          (${TASK_PUBLISHER_THROW}, ${TENANT}, ${CONSIGNEE}, ${SUBSCRIPTION}, 'subscription',
           'ORD-R4-THROW', 'CREATED', ${AWB_THROW},
           ${DATE_PUBLISHER_THROW}, '09:00:00', '18:00:00',
           ${ADDRESS_PRIMARY}, now()),
          (${TASK_SKIPPED}, ${TENANT}, ${CONSIGNEE}, ${SUBSCRIPTION}, 'subscription',
           'ORD-R4-SKIPPED', 'SKIPPED', ${AWB_SKIPPED},
           ${DATE_SKIPPED}, '09:00:00', '18:00:00',
           ${ADDRESS_PRIMARY}, now())
      `);
    });
  });

  beforeEach(() => {
    enqueueUpdateTaskSpy.mockReset();
    enqueueUpdateTaskSpy.mockImplementation(async () => undefined);
  });

  // Case 1
  it("override on materialized+PUSHED task: address backfilled, pending_update set, enqueue carries server-built snapshot + typed event", async () => {
    const result = await addSubscriptionException(ctxFor(), SUBSCRIPTION, {
      type: "address_override_one_off",
      date: DATE_PUSHED,
      idempotencyKey: randomUUID() as Uuid,
      addressOverrideId: ADDRESS_OVERRIDE,
    });

    expect(result.status).toBe("inserted");

    expect(enqueueUpdateTaskSpy).toHaveBeenCalledTimes(1);
    expect(enqueueUpdateTaskSpy).toHaveBeenCalledWith({
      tenant_id: TENANT,
      task_id: TASK_PUSHED,
      awb: AWB_PUSHED,
      patch: { consignee: EXPECTED_SNAPSHOT },
      correlation_id: result.correlationId,
    });

    await withTenant(TENANT, async (tx) => {
      type Row = { address_id: string; outbound_sync_state: string; internal_status: string };
      const rows = (await tx.execute(sqlTag`
        SELECT address_id, outbound_sync_state, internal_status
        FROM tasks WHERE id = ${TASK_PUSHED}
      `)) as readonly Row[];
      expect(rows[0].address_id).toBe(ADDRESS_OVERRIDE);
      expect(rows[0].outbound_sync_state).toBe("pending_update");
      // internal_status untouched — the override re-addresses the
      // delivery, it does not change its lifecycle state.
      expect(rows[0].internal_status).toBe("CREATED");
    });

    await withServiceRole("d52-r4 typed event check", async (tx) => {
      type Row = { event_type: string; metadata: Record<string, unknown> };
      const rows = (await tx.execute(sqlTag`
        SELECT event_type, metadata
        FROM audit_events
        WHERE metadata->>'correlation_id' = ${result.correlationId}
      `)) as readonly Row[];
      const pushed = rows.find((r) => r.event_type === "task.address_override_pushed");
      expect(pushed).toBeDefined();
      expect(pushed?.metadata).toMatchObject({
        task_id: TASK_PUSHED,
        awb: AWB_PUSHED,
        exception_id: result.exceptionId,
        address_override_id: ADDRESS_OVERRIDE,
      });
      // The local-write leg events ride the same correlation_id.
      expect(rows.some((r) => r.event_type === "subscription.exception.created")).toBe(true);
      expect(rows.some((r) => r.event_type === "subscription.address_override.applied")).toBe(
        true,
      );
    });
  });

  // Case 2
  it("override on materialized+UNPUSHED task: address backfilled locally; no enqueue; no typed event; sync state unchanged", async () => {
    const result = await addSubscriptionException(ctxFor(), SUBSCRIPTION, {
      type: "address_override_one_off",
      date: DATE_UNPUSHED,
      idempotencyKey: randomUUID() as Uuid,
      addressOverrideId: ADDRESS_OVERRIDE,
    });

    expect(result.status).toBe("inserted");
    expect(enqueueUpdateTaskSpy).not.toHaveBeenCalled();

    await withTenant(TENANT, async (tx) => {
      type Row = { address_id: string; outbound_sync_state: string };
      const rows = (await tx.execute(sqlTag`
        SELECT address_id, outbound_sync_state
        FROM tasks WHERE id = ${TASK_UNPUSHED}
      `)) as readonly Row[];
      expect(rows[0].address_id).toBe(ADDRESS_OVERRIDE);
      // Insert-time DEFAULT 'pending' (0028) — the CASE only flips
      // rows with a live AWB.
      expect(rows[0].outbound_sync_state).toBe("pending");
    });

    await withServiceRole("d52-r4 no typed event for unpushed", async (tx) => {
      type Row = { event_type: string };
      const rows = (await tx.execute(sqlTag`
        SELECT event_type FROM audit_events
        WHERE metadata->>'correlation_id' = ${result.correlationId}
          AND event_type = 'task.address_override_pushed'
      `)) as readonly Row[];
      expect(rows.length).toBe(0);
    });
  });

  // Case 3
  it("override on UNMATERIALIZED date: exception row durable; no task UPDATE; no enqueue", async () => {
    const result = await addSubscriptionException(ctxFor(), SUBSCRIPTION, {
      type: "address_override_one_off",
      date: DATE_UNMATERIALIZED,
      idempotencyKey: randomUUID() as Uuid,
      addressOverrideId: ADDRESS_OVERRIDE,
    });

    expect(result.status).toBe("inserted");
    expect(enqueueUpdateTaskSpy).not.toHaveBeenCalled();

    await withTenant(TENANT, async (tx) => {
      type Row = { id: string };
      const rows = (await tx.execute(sqlTag`
        SELECT id FROM subscription_exceptions
        WHERE subscription_id = ${SUBSCRIPTION}
          AND type = 'address_override_one_off'
          AND start_date = ${DATE_UNMATERIALIZED}
      `)) as readonly Row[];
      expect(rows.length).toBe(1);
    });
  });

  // Case 4
  it("publisher throws → service throws → local DB stays committed (address + pending_update) → no typed event", async () => {
    enqueueUpdateTaskSpy.mockImplementationOnce(async () => {
      throw new Error("QStash publish failed (test injected)");
    });

    const idempotencyKey = randomUUID() as Uuid;

    await expect(
      addSubscriptionException(ctxFor(), SUBSCRIPTION, {
        type: "address_override_one_off",
        date: DATE_PUBLISHER_THROW,
        idempotencyKey,
        addressOverrideId: ADDRESS_OVERRIDE,
      }),
    ).rejects.toThrow(/QStash publish failed/);

    await withTenant(TENANT, async (tx) => {
      type TaskRow = { address_id: string; outbound_sync_state: string };
      const tasks = (await tx.execute(sqlTag`
        SELECT address_id, outbound_sync_state
        FROM tasks WHERE id = ${TASK_PUBLISHER_THROW}
      `)) as readonly TaskRow[];
      expect(tasks[0].address_id).toBe(ADDRESS_OVERRIDE);
      expect(tasks[0].outbound_sync_state).toBe("pending_update");

      type ExcRow = { id: string };
      const exceptions = (await tx.execute(sqlTag`
        SELECT id FROM subscription_exceptions
        WHERE subscription_id = ${SUBSCRIPTION} AND idempotency_key = ${idempotencyKey}
      `)) as readonly ExcRow[];
      expect(exceptions.length).toBe(1);
    });

    await withServiceRole("d52-r4 no typed event on enqueue failure", async (tx) => {
      type Row = { event_type: string };
      const rows = (await tx.execute(sqlTag`
        SELECT ae.event_type FROM audit_events ae
        WHERE ae.event_type = 'task.address_override_pushed'
          AND ae.metadata->>'task_id' = ${TASK_PUBLISHER_THROW}
      `)) as readonly Row[];
      expect(rows.length).toBe(0);
    });
  });

  // Case 5
  it("idempotent replay (same idempotency_key) does not re-enqueue", async () => {
    const idempotencyKey = randomUUID() as Uuid;

    const first = await addSubscriptionException(ctxFor(), SUBSCRIPTION, {
      type: "address_override_one_off",
      date: DATE_REPLAY,
      idempotencyKey,
      addressOverrideId: ADDRESS_OVERRIDE,
    });
    expect(first.status).toBe("inserted");
    expect(enqueueUpdateTaskSpy).toHaveBeenCalledTimes(1);

    const second = await addSubscriptionException(ctxFor(), SUBSCRIPTION, {
      type: "address_override_one_off",
      date: DATE_REPLAY,
      idempotencyKey,
      addressOverrideId: ADDRESS_OVERRIDE,
    });
    expect(second.status).toBe("idempotent_replay");
    expect(second.httpStatus).toBe(409);
    expect(enqueueUpdateTaskSpy).toHaveBeenCalledTimes(1);
  });

  // Case 6
  it("date whose only task is SKIPPED: status filter excludes it — exception row only, task untouched, no enqueue", async () => {
    const result = await addSubscriptionException(ctxFor(), SUBSCRIPTION, {
      type: "address_override_one_off",
      date: DATE_SKIPPED,
      idempotencyKey: randomUUID() as Uuid,
      addressOverrideId: ADDRESS_OVERRIDE,
    });

    expect(result.status).toBe("inserted");
    expect(enqueueUpdateTaskSpy).not.toHaveBeenCalled();

    await withTenant(TENANT, async (tx) => {
      type Row = { address_id: string; internal_status: string };
      const rows = (await tx.execute(sqlTag`
        SELECT address_id, internal_status
        FROM tasks WHERE id = ${TASK_SKIPPED}
      `)) as readonly Row[];
      expect(rows[0].address_id).toBe(ADDRESS_PRIMARY);
      expect(rows[0].internal_status).toBe("SKIPPED");
    });
  });
});
