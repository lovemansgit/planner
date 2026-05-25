// tests/integration/task-materialization-on-demand.spec.ts
// =============================================================================
// R1 — calendar-management lane Phase 1 integration spec for the on-demand
// materializer invocation primitive (plan-PR #337 §2.R1).
//
// Five test cases:
//   1. Happy path — invokeOnDemandMaterialization synchronously materializes
//      tail tasks for a skip-extended subscription.
//   2. Audit event cron.on_demand_invoked emits with correct metadata.
//   3. Concurrency-guard (load-bearing per plan-PR §3.6 watch surface #1) —
//      parallel on-demand + simulated scheduled invocation produces no
//      duplicate task INSERTs (materializer idempotency under contention).
//   4. Idempotency — repeated single-caller invocation inserts 0 new rows
//      after the first call (materialized_through_date advances; eligible_dates
//      CTE empties).
//   5. Error propagation — invokeOnDemandMaterialization with an invalid
//      tenant id (no row in tenants) re-throws; audit event does NOT emit.
//
// Pattern follows tests/integration/task-materialization.spec.ts:
//   - Per-test fresh tenant via random UUID + slug.
//   - withServiceRole for fixture INSERTs (bypasses RLS via service role).
//   - Real invokeOnDemandMaterialization → real materializeTenant → real DB.
//   - afterEach cleanup wrapped in try/catch per audit_events_no_delete RULE
//     (memory/followup_audit_rule_cascade_conflict.md).
//
// Date pinning: materialized_through_date = 2026-05-04 (Monday). The
// on-demand primitive computes targetDate via computeTargetDateInDubai(new
// Date()), which fluctuates with wall-clock time. Tests anchor the fixture
// at a wide-open end_date so target-date drift inside the 14-day window
// doesn't break test math.
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { invokeOnDemandMaterialization } from "@/modules/task-materialization/service";
import { withServiceRole } from "@/shared/db";
import type { Actor } from "@/shared/tenant-context";
import type { Uuid } from "@/shared/types";

// ---------------------------------------------------------------------------
// Fixture seeders — inline-duplicated from
// tests/integration/task-materialization.spec.ts per §3.4 cross-module-import
// prohibition. Same shape, narrower surface (only what the on-demand spec
// needs).
// ---------------------------------------------------------------------------

const MAT_THROUGH = "2026-05-04";
const SUB_START = "2026-05-01";
const SUB_END = "2027-12-31"; // wide open — accommodates wall-clock targetDate drift
const DOW_MON_FRI = [1, 2, 3, 4, 5];

interface SeededTenant {
  tenantId: Uuid;
  slug: string;
  userId: Uuid;
}

async function seedTenant(label: string): Promise<SeededTenant> {
  const runId = randomUUID().slice(0, 8);
  const tenantId = randomUUID() as Uuid;
  const slug = `d36-r1-${label}-${runId}`;
  const userId = randomUUID() as Uuid;
  await withServiceRole(`R1 on-demand seed tenant ${label}`, async (tx) => {
    await tx.execute(sqlTag`
      INSERT INTO tenants (id, slug, name)
      VALUES (${tenantId}, ${slug}, ${`R1 on-demand ${label}`})
    `);
    // Operator-actor user row for audit emit's actor_id FK
    // (audit_events.actor_id is text, no FK; this row exists so
    // the user-actor path is realistic).
    await tx.execute(sqlTag`
      INSERT INTO users (id, tenant_id, email, role)
      VALUES (${userId}, ${tenantId}, ${`r1-${runId}@example.test`}, 'ops_manager')
    `);
  });
  return { tenantId, slug, userId };
}

async function teardownTenant(tenantId: Uuid): Promise<void> {
  // audit_events_no_delete RULE breaks DELETE CASCADE from tenants when
  // audit rows exist; try/catch keeps test cleanup hygienic anyway.
  try {
    await withServiceRole("R1 on-demand teardown", async (tx) => {
      await tx.execute(sqlTag`DELETE FROM tasks WHERE tenant_id = ${tenantId}`);
      await tx.execute(sqlTag`
        DELETE FROM subscription_exceptions WHERE tenant_id = ${tenantId}
      `);
      await tx.execute(sqlTag`
        DELETE FROM subscription_materialization WHERE tenant_id = ${tenantId}
      `);
      await tx.execute(sqlTag`DELETE FROM subscriptions WHERE tenant_id = ${tenantId}`);
      await tx.execute(sqlTag`DELETE FROM addresses WHERE tenant_id = ${tenantId}`);
      await tx.execute(sqlTag`DELETE FROM consignees WHERE tenant_id = ${tenantId}`);
      await tx.execute(sqlTag`
        DELETE FROM task_generation_runs WHERE tenant_id = ${tenantId}
      `);
      await tx.execute(sqlTag`DELETE FROM users WHERE tenant_id = ${tenantId}`);
    });
  } catch {
    /* audit RULE; ignore */
  }
}

interface SeededSubscription {
  consigneeId: Uuid;
  subscriptionId: Uuid;
  primaryAddressId: Uuid;
}

async function seedSubscription(tenantId: Uuid): Promise<SeededSubscription> {
  return withServiceRole("R1 on-demand seed subscription", async (tx) => {
    const cR = await tx.execute<{ id: Uuid }>(sqlTag`
      INSERT INTO consignees (
        tenant_id, name, phone, address_line, emirate_or_region, district
      ) VALUES (
        ${tenantId}, 'R1 Consignee',
        ${`phone-${randomUUID().slice(0, 8)}`},
        'Addr Line', 'Dubai', 'R1 District'
      )
      RETURNING id
    `);
    const consigneeId = cR[0].id;
    const aR = await tx.execute<{ id: Uuid }>(sqlTag`
      INSERT INTO addresses (
        tenant_id, consignee_id, label, is_primary, line, district, emirate
      ) VALUES (
        ${tenantId}, ${consigneeId}, 'home', true,
        'Primary Addr', 'R1 District', 'Dubai'
      )
      RETURNING id
    `);
    const primaryAddressId = aR[0].id;
    const dowText = `{${DOW_MON_FRI.join(",")}}`;
    const sR = await tx.execute<{ id: Uuid }>(sqlTag`
      INSERT INTO subscriptions (
        tenant_id, consignee_id, status,
        start_date, end_date,
        days_of_week, delivery_window_start, delivery_window_end
      ) VALUES (
        ${tenantId}, ${consigneeId}, 'active',
        ${SUB_START}, ${SUB_END},
        ${dowText}::integer[],
        '09:00', '11:00'
      )
      RETURNING id
    `);
    const subscriptionId = sR[0].id;
    await tx.execute(sqlTag`
      INSERT INTO subscription_materialization
        (subscription_id, tenant_id, materialized_through_date)
      VALUES
        (${subscriptionId}, ${tenantId}, ${MAT_THROUGH}::date)
    `);
    return { consigneeId, subscriptionId, primaryAddressId };
  });
}

async function countTasks(tenantId: Uuid, subscriptionId: Uuid): Promise<number> {
  return withServiceRole("R1 on-demand count tasks", async (tx) => {
    const r = await tx.execute<{ n: string }>(sqlTag`
      SELECT COUNT(*)::text AS n FROM tasks
      WHERE tenant_id = ${tenantId} AND subscription_id = ${subscriptionId}
    `);
    return Number(r[0].n);
  });
}

type OnDemandAuditRow = {
  metadata: Record<string, unknown>;
  actor_kind: string;
  actor_id: string;
  resource_type: string | null;
  resource_id: string | null;
};

async function findOnDemandAuditRows(
  tenantId: Uuid,
  subscriptionId: Uuid,
): Promise<readonly OnDemandAuditRow[]> {
  return withServiceRole("R1 on-demand audit query", async (tx) => {
    return tx.execute<OnDemandAuditRow>(sqlTag`
      SELECT metadata, actor_kind, actor_id, resource_type, resource_id::text
      FROM audit_events
      WHERE tenant_id = ${tenantId}
        AND event_type = 'cron.on_demand_invoked'
        AND metadata->>'subscription_id' = ${subscriptionId}
      ORDER BY occurred_at ASC
    `);
  });
}

// ---------------------------------------------------------------------------
// Actor + correlation fixtures
// ---------------------------------------------------------------------------

const makeUserActor = (userId: Uuid, tenantId: Uuid): Actor => ({
  kind: "user",
  userId,
  tenantId,
  permissions: new Set(),
});

const CORRELATION_ID = "00000000-0000-0000-0000-0000000000c1" as Uuid;
const REQUEST_ID = "r1-test-request";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("R1 / invokeOnDemandMaterialization — integration spec", () => {
  const seededTenants: Uuid[] = [];

  afterEach(async () => {
    while (seededTenants.length > 0) {
      const id = seededTenants.pop();
      if (id) await teardownTenant(id);
    }
  });

  it("(1) happy path — synchronously materializes tail tasks for a skip-extended subscription", async () => {
    const { tenantId, userId } = await seedTenant("happy");
    seededTenants.push(tenantId);
    const { subscriptionId } = await seedSubscription(tenantId);
    const tasksBefore = await countTasks(tenantId, subscriptionId);

    const result = await invokeOnDemandMaterialization({
      tenantId,
      triggeredBy: "skip_tail_end",
      subscriptionId,
      correlationId: CORRELATION_ID,
      actor: makeUserActor(userId, tenantId),
      requestId: REQUEST_ID,
    });

    const tasksAfter = await countTasks(tenantId, subscriptionId);
    expect(result.newInsertedTaskIds.length).toBeGreaterThan(0);
    expect(tasksAfter).toBeGreaterThan(tasksBefore);
    expect(tasksAfter).toBe(tasksBefore + result.newInsertedTaskIds.length);
    expect(result.cappedByGate).toBe(false);
  });

  it("(2) emits cron.on_demand_invoked audit event with correct metadata", async () => {
    const { tenantId, userId } = await seedTenant("audit");
    seededTenants.push(tenantId);
    const { subscriptionId } = await seedSubscription(tenantId);

    const result = await invokeOnDemandMaterialization({
      tenantId,
      triggeredBy: "skip_tail_end",
      subscriptionId,
      correlationId: CORRELATION_ID,
      actor: makeUserActor(userId, tenantId),
      requestId: REQUEST_ID,
    });

    const auditRows = await findOnDemandAuditRows(tenantId, subscriptionId);
    expect(auditRows).toHaveLength(1);
    const row = auditRows[0];
    expect(row.actor_kind).toBe("user");
    expect(row.actor_id).toBe(userId);
    expect(row.resource_type).toBe("task_materialization");
    expect(row.resource_id).toBe(subscriptionId);
    expect(row.metadata.tenant_id).toBe(tenantId);
    expect(row.metadata.triggered_by).toBe("skip_tail_end");
    expect(row.metadata.subscription_id).toBe(subscriptionId);
    expect(row.metadata.correlation_id).toBe(CORRELATION_ID);
    expect(typeof row.metadata.target_date).toBe("string");
    expect(row.metadata.new_inserted_task_count).toBe(result.newInsertedTaskIds.length);
    expect(row.metadata.capped_by_gate).toBe(false);
  });

  it("(3) concurrency-guard — parallel on-demand invocations produce no duplicate task INSERTs", async () => {
    const { tenantId, userId } = await seedTenant("concurrency");
    seededTenants.push(tenantId);
    const { subscriptionId } = await seedSubscription(tenantId);

    // Two parallel invocations for the same tenant + same wall-clock
    // target date. The materializer's existing idempotency (ON CONFLICT
    // DO NOTHING on (subscription_id, delivery_date) per migration 0012)
    // is load-bearing here — both calls run, but only one INSERTs each
    // row. Run-row conflict handling (writeRunRowPhase4 §4.4) handles
    // the duplicate task_generation_runs row.
    const args = {
      tenantId,
      triggeredBy: "skip_tail_end" as const,
      subscriptionId,
      correlationId: CORRELATION_ID,
      actor: makeUserActor(userId, tenantId),
      requestId: REQUEST_ID,
    };
    const [resultA, resultB] = await Promise.all([
      invokeOnDemandMaterialization(args),
      invokeOnDemandMaterialization(args),
    ]);

    const totalTasks = await countTasks(tenantId, subscriptionId);
    const insertedAcrossBothCalls =
      resultA.newInsertedTaskIds.length + resultB.newInsertedTaskIds.length;

    // The DB has exactly `totalTasks` distinct rows; the sum of
    // claimed-inserts across both calls equals that total (no
    // duplicates were silently committed). Either call could have
    // inserted all the rows or both could have split the set —
    // both shapes are valid as long as the table row count agrees.
    expect(totalTasks).toBe(insertedAcrossBothCalls);
    expect(totalTasks).toBeGreaterThan(0);
  });

  it("(4) idempotency — repeated single-caller invocation inserts 0 new rows after first", async () => {
    const { tenantId, userId } = await seedTenant("idempotency");
    seededTenants.push(tenantId);
    const { subscriptionId } = await seedSubscription(tenantId);

    const args = {
      tenantId,
      triggeredBy: "skip_tail_end" as const,
      subscriptionId,
      correlationId: CORRELATION_ID,
      actor: makeUserActor(userId, tenantId),
      requestId: REQUEST_ID,
    };

    const first = await invokeOnDemandMaterialization(args);
    const second = await invokeOnDemandMaterialization(args);
    const third = await invokeOnDemandMaterialization(args);

    expect(first.newInsertedTaskIds.length).toBeGreaterThan(0);
    expect(second.newInsertedTaskIds.length).toBe(0);
    expect(third.newInsertedTaskIds.length).toBe(0);

    const totalTasks = await countTasks(tenantId, subscriptionId);
    expect(totalTasks).toBe(first.newInsertedTaskIds.length);
  });

  it("(5) error propagation — invalid tenant id re-throws; audit event does NOT emit", async () => {
    const phantomTenantId = randomUUID() as Uuid;
    const phantomUserId = randomUUID() as Uuid;
    const phantomSubscriptionId = randomUUID() as Uuid;

    await expect(
      invokeOnDemandMaterialization({
        tenantId: phantomTenantId,
        triggeredBy: "skip_tail_end",
        subscriptionId: phantomSubscriptionId,
        correlationId: CORRELATION_ID,
        actor: makeUserActor(phantomUserId, phantomTenantId),
        requestId: REQUEST_ID,
      }),
    ).rejects.toThrow();

    // No audit row for a tenant that doesn't exist (the throw fires
    // before emit; emit is post-success only).
    const auditRows = await findOnDemandAuditRows(
      phantomTenantId,
      phantomSubscriptionId,
    );
    expect(auditRows).toHaveLength(0);
  });
});
