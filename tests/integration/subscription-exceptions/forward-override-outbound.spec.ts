// tests/integration/subscription-exceptions/forward-override-outbound.spec.ts
// =============================================================================
// Day-52 R5 (plan-PR #335 §2.R5) — forward address override →
// subscription-scoped full-upcoming backfill + SF bulk fan-out +
// materializer not-yet-materialized pickup. Real-Postgres integration per the
// schema-drift discipline; harness mirrors the sibling
// address-override-outbound.spec.ts (publisher mocked, all else real).
//
// Cases pinned:
//   1. Mixed-population backfill: EVERY upcoming task on the
//      subscription (>= start_date, NO upper date bound — Day-53
//      correction: the Day-52 ruling's 14-day figure was stale
//      pre-horizon-bump framing; full materializer horizon is 21 days)
//      gets the new address_id; pushed subset flips to
//      'pending_update'; rows BEFORE start_date, terminal rows, and a
//      SIBLING SUBSCRIPTION's rows are untouched (ruling: subscription-
//      scoped, NOT consignee-scoped). Includes the Day-53 REGRESSION
//      row: a pushed task at CURRENT_DATE + 18 days (15-21d band, which
//      the original 14-day bound missed) MUST be re-pointed + flipped +
//      fanned out. enqueueBulkUpdateTasks called once with exactly the
//      pushed subset — every payload carries the server-built
//      ConsigneeSnapshot + the exception correlation_id. Typed
//      subscription.address_override_pushed event with counts.
//   2. Not-yet-materialized pickup (ruling step iii): the exception
//      row IS the subscription-level stored address — running the
//      materializer for a beyond-horizon date (+30d, no task row yet)
//      materializes the new task at the OVERRIDE address via the CTE
//      forward branch. No subscription column write needed.
//   3. Partial fan-out failure: failedChunks > 0 → typed event emitted
//      with the counts, then service re-throws (R2 emit-then-re-throw
//      posture). Local backfill stays committed.
//   4. Unpushed-only population: backfill happens; NO enqueue; NO typed
//      event.
//   5. Idempotent replay: no second fan-out.
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const enqueueBulkUpdateTasksSpy = vi.hoisted(() =>
  vi.fn(async (payloads: readonly unknown[]) => ({
    enqueuedCount: payloads.length,
    failedChunks: 0,
    totalCount: payloads.length,
  })),
);
vi.mock("../../../src/modules/task-outbound-queue/publish", () => ({
  enqueueCancelTask: vi.fn(async () => undefined),
  enqueueUpdateTask: vi.fn(async () => undefined),
  enqueueBulkCancelTasks: vi.fn(async () => ({
    enqueuedCount: 0,
    failedChunks: 0,
    totalCount: 0,
  })),
  enqueueBulkUpdateTasks: enqueueBulkUpdateTasksSpy,
  __resetQStashClientForTest: vi.fn(),
}));

import { withServiceRole, withTenant } from "../../../src/shared/db";
import type { RequestContext } from "../../../src/shared/tenant-context";
import type { Uuid } from "../../../src/shared/types";

import { addSubscriptionException } from "../../../src/modules/subscription-exceptions";
import { materializeSubscriptionForDateRange } from "../../../src/modules/task-materialization/service";
import { ALL_PERMISSION_IDS } from "../../../src/modules/identity/permissions";

const RUN_ID = randomUUID().slice(0, 8);

function isoPlusDays(days: number): string {
  const dt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return dt.toISOString().slice(0, 10);
}

const EXPECTED_SNAPSHOT = {
  name: "R5 Forward Consignee",
  contactPhone: "+971500000513",
  address: {
    addressLine1: "Unit 3, Creek Rise",
    city: "Dubai",
    district: "Dubai Creek Harbour",
    countryCode: "AE",
  },
};

// Per-test tenants tracked for afterAll teardown. Without cleanup, the
// 10 same-created_at subscriptions this file seeds intermittently trip
// the PRE-EXISTING unstable-sort pagination spec in
// admin-subscriptions-cross-tenant.spec.ts (listAllSubscriptions has no
// deterministic ORDER BY tiebreaker — flagged as a followup; not this
// lane's fix). Teardown mirrors task-materialization-per-sub.spec.ts:
// children only, tenants row kept (audit_events_no_delete RULE breaks
// ON DELETE CASCADE from tenants — see
// memory/followup_audit_rule_cascade_conflict.md).
const SEEDED_TENANTS: Uuid[] = [];

interface Seeded {
  tenant: Uuid;
  user: Uuid;
  consignee: Uuid;
  addressPrimary: Uuid;
  addressOverride: Uuid;
  subscription: Uuid;
  siblingSubscription: Uuid;
}

function ctxFor(seeded: Seeded): RequestContext {
  return {
    actor: {
      kind: "user",
      userId: seeded.user,
      tenantId: seeded.tenant,
      permissions: new Set(ALL_PERMISSION_IDS) as unknown as Set<never>,
      email: `${seeded.user}@d52-r5.example`,
      displayName: null,
    },
    tenantId: seeded.tenant,
    requestId: `req-${RUN_ID}`,
    path: "/api/test",
  };
}

/**
 * Per-test fresh tenant + two subscriptions on one consignee. Returns
 * ids; callers seed tasks per case. Subscription days_of_week covers
 * all 7 weekdays so relative dates are always eligible.
 */
async function seedBase(label: string): Promise<Seeded> {
  const tenant = randomUUID() as Uuid;
  const user = randomUUID() as Uuid;
  const consignee = randomUUID() as Uuid;
  const addressPrimary = randomUUID() as Uuid;
  const addressOverride = randomUUID() as Uuid;
  const subscription = randomUUID() as Uuid;
  const siblingSubscription = randomUUID() as Uuid;
  const slug = `d52-r5-${label}-${RUN_ID}`;

  await withServiceRole(`d52-r5 seed ${label}`, async (tx) => {
    await tx.execute(sqlTag`
      INSERT INTO tenants (id, slug, name, status)
      VALUES (${tenant}, ${slug}, 'D52 R5 Forward Test Tenant', 'active')
    `);
    await tx.execute(sqlTag`
      INSERT INTO roles (tenant_id, name, slug, description) VALUES
        (NULL, 'Tenant Admin', 'tenant-admin', 'd52 r5 seed')
      ON CONFLICT (tenant_id, slug) DO NOTHING
    `);
    await tx.execute(sqlTag`
      INSERT INTO auth.users (id, email)
      VALUES (${user}, ${user + "@d52-r5.example"})
    `);
    await tx.execute(sqlTag`
      INSERT INTO users (id, tenant_id, email)
      VALUES (${user}, ${tenant}, ${user + "@d52-r5.example"})
    `);
    await tx.execute(sqlTag`
      INSERT INTO role_assignments (user_id, role_id, tenant_id)
      SELECT ${user}, r.id, ${tenant} FROM roles r
      WHERE r.tenant_id IS NULL AND r.slug = 'tenant-admin'
    `);
    await tx.execute(sqlTag`
      INSERT INTO consignees (
        id, tenant_id, name, email, phone,
        address_line, emirate_or_region, district
      ) VALUES (${consignee}, ${tenant}, 'R5 Forward Consignee', 'cons@d52-r5.test',
                '+971500000513', 'Old Line', 'Dubai', 'Old District')
    `);
    await tx.execute(sqlTag`
      INSERT INTO addresses (id, tenant_id, consignee_id, label, is_primary, line, district, emirate)
      VALUES
        (${addressPrimary}, ${tenant}, ${consignee},
         'home', true, 'Old Line', 'Old District', 'Dubai'),
        (${addressOverride}, ${tenant}, ${consignee},
         'office', false, 'Unit 3, Creek Rise', 'Dubai Creek Harbour', 'Dubai')
    `);
    await tx.execute(sqlTag`
      INSERT INTO subscriptions (
        id, tenant_id, consignee_id, status, start_date, end_date,
        days_of_week, delivery_window_start, delivery_window_end
      ) VALUES
        (${subscription}, ${tenant}, ${consignee}, 'active',
         ${isoPlusDays(1)}, ${isoPlusDays(120)},
         ARRAY[1,2,3,4,5,6,7]::int[], '09:00:00', '18:00:00'),
        (${siblingSubscription}, ${tenant}, ${consignee}, 'active',
         ${isoPlusDays(1)}, ${isoPlusDays(120)},
         ARRAY[1,2,3,4,5,6,7]::int[], '09:00:00', '18:00:00')
    `);
  });

  SEEDED_TENANTS.push(tenant);
  return { tenant, user, consignee, addressPrimary, addressOverride, subscription, siblingSubscription };
}

afterAll(async () => {
  try {
    await withServiceRole("d52-r5 teardown", async (tx) => {
      for (const tenant of SEEDED_TENANTS) {
        await tx.execute(sqlTag`DELETE FROM tasks WHERE tenant_id = ${tenant}`);
        await tx.execute(sqlTag`DELETE FROM subscription_exceptions WHERE tenant_id = ${tenant}`);
        await tx.execute(sqlTag`DELETE FROM subscription_materialization WHERE tenant_id = ${tenant}`);
        await tx.execute(sqlTag`DELETE FROM subscriptions WHERE tenant_id = ${tenant}`);
        await tx.execute(sqlTag`DELETE FROM addresses WHERE tenant_id = ${tenant}`);
        await tx.execute(sqlTag`DELETE FROM consignees WHERE tenant_id = ${tenant}`);
      }
    });
  } catch {
    /* audit RULE / FK ordering; best-effort cleanup */
  }
});

interface SeedTaskInput {
  seeded: Seeded;
  id: Uuid;
  subscriptionId: Uuid;
  date: string;
  awb?: string | null;
  internalStatus?: string;
}

async function seedTask(input: SeedTaskInput): Promise<void> {
  const { seeded, id, subscriptionId, date } = input;
  const awb = input.awb ?? null;
  const status = input.internalStatus ?? "CREATED";
  await withServiceRole(`d52-r5 seed task`, async (tx) => {
    await tx.execute(sqlTag`
      INSERT INTO tasks (
        id, tenant_id, consignee_id, subscription_id, created_via,
        customer_order_number, internal_status, external_tracking_number,
        delivery_date, delivery_start_time, delivery_end_time,
        address_id, pushed_to_external_at
      ) VALUES (
        ${id}, ${seeded.tenant}, ${seeded.consignee}, ${subscriptionId}, 'subscription',
        ${`ORD-R5-${id.slice(0, 8)}`}, ${status}, ${awb},
        ${date}, '09:00:00', '18:00:00',
        ${seeded.addressPrimary}, ${awb !== null ? sqlTag`now()` : null}
      )
    `);
  });
}

async function readTask(
  tenant: Uuid,
  id: Uuid,
): Promise<{ address_id: string; outbound_sync_state: string; internal_status: string }> {
  return withTenant(tenant, async (tx) => {
    type Row = { address_id: string; outbound_sync_state: string; internal_status: string };
    const rows = (await tx.execute(sqlTag`
      SELECT address_id, outbound_sync_state, internal_status
      FROM tasks WHERE id = ${id}
    `)) as readonly Row[];
    return rows[0];
  });
}

describe("Day-52 R5 (Day-53 horizon correction) — forward address override → full-upcoming backfill + SF bulk fan-out", () => {
  beforeEach(() => {
    enqueueBulkUpdateTasksSpy.mockReset();
    enqueueBulkUpdateTasksSpy.mockImplementation(async (payloads: readonly unknown[]) => ({
      enqueuedCount: payloads.length,
      failedChunks: 0,
      totalCount: payloads.length,
    }));
  });

  // Case 1 (incl. the Day-53 +18d regression row)
  it("backfills EVERY upcoming task on THIS subscription incl. the 15-21d band; pushed subset fans out with snapshot; start/sibling boundaries hold", async () => {
    const seeded = await seedBase("mixed");
    const startDate = isoPlusDays(2);

    const TASK_BEFORE_START = randomUUID() as Uuid; // BEFORE start_date — untouched
    const TASK_PUSHED_A = randomUUID() as Uuid;
    const TASK_PUSHED_B = randomUUID() as Uuid;
    // Day-53 regression: pushed task in the 15-21d band the original
    // 14-day bound missed (operator-visible wrong address forever,
    // since the materializer's ON CONFLICT DO NOTHING never repairs
    // an existing row).
    const TASK_PUSHED_FAR = randomUUID() as Uuid;
    const TASK_UNPUSHED = randomUUID() as Uuid;
    const TASK_DELIVERED = randomUUID() as Uuid; // terminal — excluded
    const TASK_SIBLING = randomUUID() as Uuid; // other subscription — untouched

    const AWB_A = `AWB-R5-${RUN_ID}-A`;
    const AWB_B = `AWB-R5-${RUN_ID}-B`;
    const AWB_FAR = `AWB-R5-${RUN_ID}-FAR`;

    await seedTask({ seeded, id: TASK_BEFORE_START, subscriptionId: seeded.subscription, date: isoPlusDays(1), awb: `AWB-R5-${RUN_ID}-PRE` });
    await seedTask({ seeded, id: TASK_PUSHED_A, subscriptionId: seeded.subscription, date: isoPlusDays(3), awb: AWB_A });
    await seedTask({ seeded, id: TASK_PUSHED_B, subscriptionId: seeded.subscription, date: isoPlusDays(9), awb: AWB_B });
    await seedTask({ seeded, id: TASK_PUSHED_FAR, subscriptionId: seeded.subscription, date: isoPlusDays(18), awb: AWB_FAR });
    await seedTask({ seeded, id: TASK_UNPUSHED, subscriptionId: seeded.subscription, date: isoPlusDays(6) });
    await seedTask({ seeded, id: TASK_DELIVERED, subscriptionId: seeded.subscription, date: isoPlusDays(4), awb: `AWB-R5-${RUN_ID}-DEL`, internalStatus: "DELIVERED" });
    await seedTask({ seeded, id: TASK_SIBLING, subscriptionId: seeded.siblingSubscription, date: isoPlusDays(5), awb: `AWB-R5-${RUN_ID}-SIB` });

    const result = await addSubscriptionException(ctxFor(seeded), seeded.subscription, {
      type: "address_override_forward",
      date: startDate,
      idempotencyKey: randomUUID() as Uuid,
      addressOverrideId: seeded.addressOverride,
    });
    expect(result.status).toBe("inserted");

    // Backfilled in-window rows.
    const pushedA = await readTask(seeded.tenant, TASK_PUSHED_A);
    expect(pushedA.address_id).toBe(seeded.addressOverride);
    expect(pushedA.outbound_sync_state).toBe("pending_update");
    const pushedB = await readTask(seeded.tenant, TASK_PUSHED_B);
    expect(pushedB.address_id).toBe(seeded.addressOverride);
    expect(pushedB.outbound_sync_state).toBe("pending_update");
    // Day-53 regression assertion: the +18d row (beyond the retired
    // 14-day bound, within the 21-day horizon) is re-pointed + flipped.
    const pushedFar = await readTask(seeded.tenant, TASK_PUSHED_FAR);
    expect(pushedFar.address_id).toBe(seeded.addressOverride);
    expect(pushedFar.outbound_sync_state).toBe("pending_update");
    const unpushed = await readTask(seeded.tenant, TASK_UNPUSHED);
    expect(unpushed.address_id).toBe(seeded.addressOverride);
    expect(unpushed.outbound_sync_state).toBe("pending");

    // Boundary rows untouched.
    const before = await readTask(seeded.tenant, TASK_BEFORE_START);
    expect(before.address_id).toBe(seeded.addressPrimary);
    const delivered = await readTask(seeded.tenant, TASK_DELIVERED);
    expect(delivered.address_id).toBe(seeded.addressPrimary);
    const sibling = await readTask(seeded.tenant, TASK_SIBLING);
    expect(sibling.address_id).toBe(seeded.addressPrimary);

    // Fan-out: exactly the pushed subset, snapshot + shared correlation.
    expect(enqueueBulkUpdateTasksSpy).toHaveBeenCalledTimes(1);
    const payloads = enqueueBulkUpdateTasksSpy.mock.calls[0][0] as readonly {
      tenant_id: string;
      task_id: string;
      awb: string;
      patch: { consignee: unknown };
      correlation_id: string;
    }[];
    expect(payloads).toHaveLength(3);
    const byTask = new Map(payloads.map((p) => [p.task_id, p]));
    expect(byTask.get(TASK_PUSHED_A)?.awb).toBe(AWB_A);
    expect(byTask.get(TASK_PUSHED_B)?.awb).toBe(AWB_B);
    expect(byTask.get(TASK_PUSHED_FAR)?.awb).toBe(AWB_FAR);
    for (const p of payloads) {
      expect(p.tenant_id).toBe(seeded.tenant);
      expect(p.correlation_id).toBe(result.correlationId);
      expect(p.patch.consignee).toEqual(EXPECTED_SNAPSHOT);
    }

    // Typed bulk event with counts (backfilled=4 upcoming rows; pushed=3).
    await withServiceRole("d52-r5 typed event check", async (tx) => {
      type Row = { event_type: string; metadata: Record<string, unknown> };
      const rows = (await tx.execute(sqlTag`
        SELECT event_type, metadata FROM audit_events
        WHERE metadata->>'correlation_id' = ${result.correlationId}
          AND event_type = 'subscription.address_override_pushed'
      `)) as readonly Row[];
      expect(rows.length).toBe(1);
      expect(rows[0].metadata).toMatchObject({
        subscription_id: seeded.subscription,
        exception_id: result.exceptionId,
        address_override_id: seeded.addressOverride,
        backfilled_task_count: 4,
        pushed_task_count: 3,
        enqueued_count: 3,
        failed_chunks: 0,
        effective_from: startDate,
      });
    });
  });

  // Case 2 — future-horizon pickup via the CTE forward branch (ruling step iii)
  it("materializer picks up the forward override for not-yet-materialized future dates from the exception row alone", async () => {
    const seeded = await seedBase("cte");
    const startDate = isoPlusDays(2);

    const result = await addSubscriptionException(ctxFor(seeded), seeded.subscription, {
      type: "address_override_forward",
      date: startDate,
      idempotencyKey: randomUUID() as Uuid,
      addressOverrideId: seeded.addressOverride,
    });
    expect(result.status).toBe("inserted");
    // No tasks existed → no fan-out.
    expect(enqueueBulkUpdateTasksSpy).not.toHaveBeenCalled();

    // Materialize a beyond-horizon single day (the scheduled cron's job);
    // the CTE's forward-override branch must resolve the override
    // address with NO subscription column having been written.
    const futureDate = isoPlusDays(30);
    const matResult = await withServiceRole("d52-r5 cte materialize", async (tx) =>
      materializeSubscriptionForDateRange(tx, {
        subscriptionId: seeded.subscription as Uuid,
        startDate: futureDate,
        endDate: futureDate,
        requestId: `req-r5-cte-${RUN_ID}`,
      }),
    );
    expect(matResult.newInsertedTaskIds).toHaveLength(1);

    await withTenant(seeded.tenant, async (tx) => {
      type Row = { address_id: string };
      const rows = (await tx.execute(sqlTag`
        SELECT address_id FROM tasks
        WHERE subscription_id = ${seeded.subscription}
          AND delivery_date = ${futureDate}
      `)) as readonly Row[];
      expect(rows.length).toBe(1);
      expect(rows[0].address_id).toBe(seeded.addressOverride);
    });
  });

  // Case 3 — partial fan-out failure: emit-then-re-throw (R2 posture)
  it("failedChunks > 0 → typed event emitted with counts, then service re-throws; local backfill stays committed", async () => {
    const seeded = await seedBase("partial");
    const startDate = isoPlusDays(2);
    const TASK_PUSHED = randomUUID() as Uuid;
    await seedTask({ seeded, id: TASK_PUSHED, subscriptionId: seeded.subscription, date: isoPlusDays(3), awb: `AWB-R5-${RUN_ID}-PF` });

    enqueueBulkUpdateTasksSpy.mockImplementationOnce(async (payloads: readonly unknown[]) => ({
      enqueuedCount: 0,
      failedChunks: 1,
      totalCount: payloads.length,
    }));

    const idempotencyKey = randomUUID() as Uuid;
    await expect(
      addSubscriptionException(ctxFor(seeded), seeded.subscription, {
        type: "address_override_forward",
        date: startDate,
        idempotencyKey,
        addressOverrideId: seeded.addressOverride,
      }),
    ).rejects.toThrow(/fan-out partially failed/);

    // Local DB committed: backfill + pending_update + exception row.
    const task = await readTask(seeded.tenant, TASK_PUSHED);
    expect(task.address_id).toBe(seeded.addressOverride);
    expect(task.outbound_sync_state).toBe("pending_update");

    await withServiceRole("d52-r5 partial event check", async (tx) => {
      type Row = { metadata: Record<string, unknown> };
      const rows = (await tx.execute(sqlTag`
        SELECT metadata FROM audit_events
        WHERE event_type = 'subscription.address_override_pushed'
          AND metadata->>'subscription_id' = ${seeded.subscription}
      `)) as readonly Row[];
      expect(rows.length).toBe(1);
      expect(rows[0].metadata).toMatchObject({
        pushed_task_count: 1,
        enqueued_count: 0,
        failed_chunks: 1,
      });
    });
  });

  // Case 4 — unpushed-only population
  it("unpushed-only backfill: addresses updated; no fan-out; no typed event", async () => {
    const seeded = await seedBase("unpushed");
    const startDate = isoPlusDays(2);
    const TASK_UNPUSHED = randomUUID() as Uuid;
    await seedTask({ seeded, id: TASK_UNPUSHED, subscriptionId: seeded.subscription, date: isoPlusDays(5) });

    const result = await addSubscriptionException(ctxFor(seeded), seeded.subscription, {
      type: "address_override_forward",
      date: startDate,
      idempotencyKey: randomUUID() as Uuid,
      addressOverrideId: seeded.addressOverride,
    });
    expect(result.status).toBe("inserted");
    expect(enqueueBulkUpdateTasksSpy).not.toHaveBeenCalled();

    const task = await readTask(seeded.tenant, TASK_UNPUSHED);
    expect(task.address_id).toBe(seeded.addressOverride);
    expect(task.outbound_sync_state).toBe("pending");

    await withServiceRole("d52-r5 no typed event", async (tx) => {
      type Row = { id: string };
      const rows = (await tx.execute(sqlTag`
        SELECT id FROM audit_events
        WHERE event_type = 'subscription.address_override_pushed'
          AND metadata->>'correlation_id' = ${result.correlationId}
      `)) as readonly Row[];
      expect(rows.length).toBe(0);
    });
  });

  // Case 5 — idempotent replay
  it("idempotent replay (same idempotency_key) does not re-fan-out", async () => {
    const seeded = await seedBase("replay");
    const startDate = isoPlusDays(2);
    const TASK_PUSHED = randomUUID() as Uuid;
    await seedTask({ seeded, id: TASK_PUSHED, subscriptionId: seeded.subscription, date: isoPlusDays(3), awb: `AWB-R5-${RUN_ID}-RP` });

    const idempotencyKey = randomUUID() as Uuid;
    const first = await addSubscriptionException(ctxFor(seeded), seeded.subscription, {
      type: "address_override_forward",
      date: startDate,
      idempotencyKey,
      addressOverrideId: seeded.addressOverride,
    });
    expect(first.status).toBe("inserted");
    expect(enqueueBulkUpdateTasksSpy).toHaveBeenCalledTimes(1);

    const second = await addSubscriptionException(ctxFor(seeded), seeded.subscription, {
      type: "address_override_forward",
      date: startDate,
      idempotencyKey,
      addressOverrideId: seeded.addressOverride,
    });
    expect(second.status).toBe("idempotent_replay");
    expect(enqueueBulkUpdateTasksSpy).toHaveBeenCalledTimes(1);
  });
});
