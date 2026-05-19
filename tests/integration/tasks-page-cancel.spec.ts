// tests/integration/tasks-page-cancel.spec.ts
// =============================================================================
// Day-30 B2 — /tasks-page cancel action integration tests (plan #308 v2 §5.1).
//
// Cases pinned:
//   B2-I1  — subscription-linked cancel end-to-end:
//            external_tracking_number IS NOT NULL → action returns success,
//            subscription_exceptions row inserted, tasks.internal_status='SKIPPED',
//            tasks.outbound_sync_state='pending_cancel', enqueueCancelTask invoked once.
//   B2-I2′ — ad-hoc cancel REJECTED via single-canonical-path enforcement
//            (per §3.6 OQ-1 ruling): action returns { kind: 'validation' };
//            no DB writes; no enqueue.
//   B2-I3  — subscription-linked cancel past cutoff: ValidationError surfaces
//            as { kind: 'validation' }; no DB writes; no enqueue.
//   B2-I8  — ASSIGNED-state task cancel succeeds (pre-existing behaviour;
//            confirms B2 does not regress to a new ASSIGNED-state guard).
//
// Self-contained — own tenant/user/subscription/task seed; mirrors the
// skip-outbound.spec.ts pattern at tests/integration/subscription-exceptions/.
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Hoisted publisher spy so the action picks up the mock at import time.
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

// next/cache revalidatePath is a no-op outside request context.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const RUN_ID = randomUUID().slice(0, 8);
const TENANT = randomUUID();
const SLUG = `b2-cancel-${RUN_ID}`;
const USER = randomUUID();
const CONSIGNEE = randomUUID();
const ADDRESS = randomUUID();
const SUBSCRIPTION = randomUUID();

const TASK_SUB_LINKED = randomUUID();
const TASK_AD_HOC = randomUUID();
const TASK_PAST_CUTOFF = randomUUID();
const TASK_ASSIGNED = randomUUID();

const AWB_SUB_LINKED = `AWB-B2-${RUN_ID}-SUB`;
const AWB_AD_HOC = `AWB-B2-${RUN_ID}-AH`;
const AWB_PAST_CUTOFF = `AWB-B2-${RUN_ID}-CUTOFF`;
const AWB_ASSIGNED = `AWB-B2-${RUN_ID}-ASSIGNED`;

function nextWedAfter(daysOffset: number): string {
  const dt = new Date(Date.now() + daysOffset * 24 * 60 * 60 * 1000);
  const day = dt.getUTCDay();
  const wedDelta = ((3 - day + 7) % 7) || 7;
  dt.setUTCDate(dt.getUTCDate() + wedDelta);
  return dt.toISOString().slice(0, 10);
}

const DATE_SUB = nextWedAfter(40);
const DATE_AD_HOC = nextWedAfter(50);
const DATE_PAST = "2020-01-08"; // far past — guaranteed past cutoff
const DATE_ASSIGNED = nextWedAfter(60);
const SUBSCRIPTION_END = nextWedAfter(120);

// Mock buildRequestContext to inject a fully-permissioned tenant-scoped actor.
vi.mock("../../src/shared/request-context", async () => {
  const { ALL_PERMISSION_IDS } = await import(
    "../../src/modules/identity/permissions"
  );
  return {
    buildRequestContext: vi.fn(async () => ({
      actor: {
        kind: "user",
        userId: USER,
        tenantId: TENANT,
        permissions: new Set(ALL_PERMISSION_IDS),
        email: `${USER}@b2-cancel.example`,
        displayName: null,
      },
      tenantId: TENANT,
      requestId: `req-${RUN_ID}`,
      path: "/tasks",
    })),
  };
});

import { cancelTaskAction } from "../../src/app/(app)/tasks/_actions";
import { withServiceRole } from "../../src/shared/db";

describe("Day-30 B2 — /tasks cancelTaskAction (real Postgres)", () => {
  beforeAll(async () => {
    enqueueCancelTaskSpy.mockClear();
    await withServiceRole("B2 cancel test seed", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, status) VALUES
          (${TENANT}, ${SLUG}, 'B2 Cancel Test', 'active')
      `);
      await tx.execute(sqlTag`
        INSERT INTO consignees (id, tenant_id, name, phone, address_line, emirate_or_region, district)
        VALUES (${CONSIGNEE}, ${TENANT}, 'B2 Test Consignee', ${`+97150b2${RUN_ID}`},
                'Test Building', 'Dubai', 'Test District')
      `);
      await tx.execute(sqlTag`
        INSERT INTO addresses (id, tenant_id, consignee_id, label, line, district, emirate, is_primary)
        VALUES (${ADDRESS}, ${TENANT}, ${CONSIGNEE}, 'home', 'Tower 1', 'Marina', 'Dubai', true)
      `);
      // Real subscriptions schema (migration 0009): no address_id column —
      // address lives on the dedicated addresses table + subscription_address_rotations
      // join (migration 0014), or per-subscription one-off via
      // delivery_address_override jsonb. tasks.address_id is what the cancel
      // path actually reads. No tail_end_cap_date column exists either.
      await tx.execute(sqlTag`
        INSERT INTO subscriptions (
          id, tenant_id, consignee_id, status, start_date, end_date,
          days_of_week, delivery_window_start, delivery_window_end
        ) VALUES (
          ${SUBSCRIPTION}, ${TENANT}, ${CONSIGNEE}, 'active',
          ${nextWedAfter(20)}, ${SUBSCRIPTION_END},
          ARRAY[1,2,3,4,5,6,7]::int[], '08:00:00', '10:00:00'
        )
      `);
      // B2-I1 — subscription-linked task, pushed to SF.
      await tx.execute(sqlTag`
        INSERT INTO tasks (
          id, tenant_id, consignee_id, subscription_id, address_id,
          customer_order_number, external_id, external_tracking_number,
          internal_status, delivery_date, delivery_start_time, delivery_end_time,
          created_via
        ) VALUES (
          ${TASK_SUB_LINKED}, ${TENANT}, ${CONSIGNEE}, ${SUBSCRIPTION}, ${ADDRESS},
          ${`B2-SUB-${RUN_ID}`}, ${`SF-${RUN_ID}-1`}, ${AWB_SUB_LINKED},
          'CREATED', ${DATE_SUB}, '08:00:00', '10:00:00', 'subscription'
        )
      `);
      // B2-I2′ — ad-hoc task (subscription_id IS NULL).
      await tx.execute(sqlTag`
        INSERT INTO tasks (
          id, tenant_id, consignee_id, subscription_id, address_id,
          customer_order_number, external_id, external_tracking_number,
          internal_status, delivery_date, delivery_start_time, delivery_end_time,
          created_via
        ) VALUES (
          ${TASK_AD_HOC}, ${TENANT}, ${CONSIGNEE}, NULL, ${ADDRESS},
          ${`B2-AH-${RUN_ID}`}, ${`SF-${RUN_ID}-2`}, ${AWB_AD_HOC},
          'CREATED', ${DATE_AD_HOC}, '08:00:00', '10:00:00', 'manual_admin'
        )
      `);
      // B2-I3 — subscription-linked task with past delivery_date (past cutoff).
      await tx.execute(sqlTag`
        INSERT INTO tasks (
          id, tenant_id, consignee_id, subscription_id, address_id,
          customer_order_number, external_id, external_tracking_number,
          internal_status, delivery_date, delivery_start_time, delivery_end_time,
          created_via
        ) VALUES (
          ${TASK_PAST_CUTOFF}, ${TENANT}, ${CONSIGNEE}, ${SUBSCRIPTION}, ${ADDRESS},
          ${`B2-CUTOFF-${RUN_ID}`}, ${`SF-${RUN_ID}-3`}, ${AWB_PAST_CUTOFF},
          'CREATED', ${DATE_PAST}, '08:00:00', '10:00:00', 'subscription'
        )
      `);
      // B2-I8 — ASSIGNED-state task, pre-cutoff.
      await tx.execute(sqlTag`
        INSERT INTO tasks (
          id, tenant_id, consignee_id, subscription_id, address_id,
          customer_order_number, external_id, external_tracking_number,
          internal_status, delivery_date, delivery_start_time, delivery_end_time,
          created_via
        ) VALUES (
          ${TASK_ASSIGNED}, ${TENANT}, ${CONSIGNEE}, ${SUBSCRIPTION}, ${ADDRESS},
          ${`B2-ASSIGNED-${RUN_ID}`}, ${`SF-${RUN_ID}-4`}, ${AWB_ASSIGNED},
          'ASSIGNED', ${DATE_ASSIGNED}, '08:00:00', '10:00:00', 'subscription'
        )
      `);
    });
  });

  // ---------------------------------------------------------------------------
  // B2-I1 — subscription-linked cancel end-to-end
  // ---------------------------------------------------------------------------

  it("B2-I1 — subscription-linked cancel succeeds + enqueueCancelTask invoked", async () => {
    enqueueCancelTaskSpy.mockClear();

    const result = await cancelTaskAction(TASK_SUB_LINKED, { kind: "idle" }, new FormData());

    expect(result.kind).toBe("success");
    expect(enqueueCancelTaskSpy).toHaveBeenCalledTimes(1);

    const [task] = await withServiceRole("B2-I1 verify", async (tx) =>
      tx.execute(sqlTag`
        SELECT internal_status, outbound_sync_state
        FROM tasks WHERE id = ${TASK_SUB_LINKED} LIMIT 1
      `),
    );
    expect((task as { internal_status: string }).internal_status).toBe("SKIPPED");
    expect((task as { outbound_sync_state: string }).outbound_sync_state).toBe(
      "pending_cancel",
    );

    const exceptions = await withServiceRole("B2-I1 exception check", async (tx) =>
      tx.execute(sqlTag`
        SELECT type, skip_without_append FROM subscription_exceptions
        WHERE subscription_id = ${SUBSCRIPTION}
          AND start_date = ${DATE_SUB}
      `),
    );
    expect(exceptions).toHaveLength(1);
    expect((exceptions[0] as { type: string }).type).toBe("skip");
    expect((exceptions[0] as { skip_without_append: boolean }).skip_without_append).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // B2-I2′ — ad-hoc cancel REJECTED (single-canonical-path enforcement)
  // ---------------------------------------------------------------------------

  it("B2-I2′ — ad-hoc cancel rejected server-side with validation kind; no DB writes; no enqueue", async () => {
    enqueueCancelTaskSpy.mockClear();

    const result = await cancelTaskAction(TASK_AD_HOC, { kind: "idle" }, new FormData());

    expect(result.kind).toBe("validation");
    if (result.kind === "validation") {
      expect(result.message).toMatch(/ad-hoc tasks cannot be cancelled from \/tasks/i);
    }
    expect(enqueueCancelTaskSpy).not.toHaveBeenCalled();

    const [task] = await withServiceRole("B2-I2′ verify no writes", async (tx) =>
      tx.execute(sqlTag`
        SELECT internal_status FROM tasks WHERE id = ${TASK_AD_HOC} LIMIT 1
      `),
    );
    expect((task as { internal_status: string }).internal_status).toBe("CREATED");

    // No subscription_exceptions row should exist within THIS run's tenant
    // for the ad-hoc date. Scope by tenant_id — every exception row carries
    // tenant_id (repository.ts:112) and parallel integration specs
    // (exception-model-happy-path, skip-sf-outbound-and-webhook-convergence,
    // subscription-exceptions/*) also write exceptions for calendar dates
    // derived from Date.now() with similar offsets, so a date-only query is
    // not isolated. The contract being pinned is "the cancel action did NOT
    // write an exception" — for OUR tenant — which is what tenant scoping
    // asserts.
    const exceptions = await withServiceRole("B2-I2′ no exception row", async (tx) =>
      tx.execute(sqlTag`
        SELECT id FROM subscription_exceptions
        WHERE start_date = ${DATE_AD_HOC}
          AND tenant_id = ${TENANT}
      `),
    );
    expect(exceptions).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // B2-I3 — subscription-linked cancel past cutoff
  // ---------------------------------------------------------------------------

  it("B2-I3 — cancel past 18:00 Dubai cutoff returns validation kind; no enqueue", async () => {
    enqueueCancelTaskSpy.mockClear();

    const result = await cancelTaskAction(TASK_PAST_CUTOFF, { kind: "idle" }, new FormData());

    expect(result.kind).toBe("validation");
    if (result.kind === "validation") {
      expect(result.message).toMatch(/cut-off/i);
    }
    expect(enqueueCancelTaskSpy).not.toHaveBeenCalled();

    const [task] = await withServiceRole("B2-I3 verify", async (tx) =>
      tx.execute(sqlTag`
        SELECT internal_status FROM tasks WHERE id = ${TASK_PAST_CUTOFF} LIMIT 1
      `),
    );
    expect((task as { internal_status: string }).internal_status).toBe("CREATED");
  });

  // ---------------------------------------------------------------------------
  // B2-I8 — ASSIGNED-state cancel succeeds (pre-existing behaviour; pin contract)
  // ---------------------------------------------------------------------------

  it("B2-I8 — ASSIGNED-state task cancel succeeds; B2 does not regress to a new ASSIGNED guard", async () => {
    enqueueCancelTaskSpy.mockClear();

    const result = await cancelTaskAction(TASK_ASSIGNED, { kind: "idle" }, new FormData());

    expect(result.kind).toBe("success");
    expect(enqueueCancelTaskSpy).toHaveBeenCalledTimes(1);

    const [task] = await withServiceRole("B2-I8 verify", async (tx) =>
      tx.execute(sqlTag`
        SELECT internal_status FROM tasks WHERE id = ${TASK_ASSIGNED} LIMIT 1
      `),
    );
    expect((task as { internal_status: string }).internal_status).toBe("SKIPPED");
  });
});
