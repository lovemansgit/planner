// tests/integration/task-materialization-per-sub.spec.ts
//
// Day-19 / Phase 1 / OQ-2 — `materializeSubscriptionForDateRange`
// integration coverage. Mirrors the seeding pattern from
// tests/integration/task-materialization.spec.ts (per-test fresh tenant
// + audit-RULE-aware teardown).
//
// Cases:
//   1. Happy path — single sub, Mon-Fri, 14-day range, all dates
//      materialize against primary address. Idempotent re-run = zero
//      additional inserts.
//   2. Edge: startDate == endDate (single-day range; 1 task or 0
//      depending on weekday eligibility).
//   3. Edge: range > 30 days — 6 weeks of Mon-Fri, 30 tasks.
//   4. Address resolution failure — sub with no primary address, no
//      rotation, no override. addressResolutionFailedCount surfaces;
//      zero tasks inserted.

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { materializeSubscriptionForDateRange } from "@/modules/task-materialization/service";
import { withServiceRole } from "@/shared/db";
import type { Uuid } from "@/shared/types";

const SUB_START = "2099-01-01"; // far future to avoid demo / fixture clashes
const SUB_END = "2099-12-31";
const DOW_MON_FRI = [1, 2, 3, 4, 5];

interface SeededTenant {
  tenantId: string;
  slug: string;
}

async function seedTenant(label: string): Promise<SeededTenant> {
  const runId = randomUUID().slice(0, 8);
  const tenantId = randomUUID();
  const slug = `d19-mat-sub-${label}-${runId}`;
  await withServiceRole(`d19 mat-sub seed tenant ${label}`, async (tx) => {
    await tx.execute(sqlTag`
      INSERT INTO tenants (id, slug, name)
      VALUES (${tenantId}, ${slug}, ${`d19 mat-sub ${label}`})
    `);
  });
  return { tenantId, slug };
}

async function teardownTenant(tenantId: string): Promise<void> {
  // Cleanup wrapped in try/catch — audit_events_no_delete RULE (0002).
  try {
    await withServiceRole("d19 mat-sub teardown", async (tx) => {
      await tx.execute(sqlTag`DELETE FROM tasks WHERE tenant_id = ${tenantId}`);
      await tx.execute(sqlTag`
        DELETE FROM subscription_address_rotations WHERE tenant_id = ${tenantId}
      `);
      await tx.execute(sqlTag`
        DELETE FROM subscription_exceptions WHERE tenant_id = ${tenantId}
      `);
      await tx.execute(sqlTag`
        DELETE FROM subscription_materialization WHERE tenant_id = ${tenantId}
      `);
      await tx.execute(sqlTag`DELETE FROM subscriptions WHERE tenant_id = ${tenantId}`);
      await tx.execute(sqlTag`DELETE FROM addresses WHERE tenant_id = ${tenantId}`);
      await tx.execute(sqlTag`DELETE FROM consignees WHERE tenant_id = ${tenantId}`);
    });
  } catch {
    /* audit RULE; ignore */
  }
}

interface SeedSubInput {
  tenantId: string;
  daysOfWeek?: readonly number[];
  primaryAddress?: boolean;
}

interface SeededSub {
  consigneeId: Uuid;
  subscriptionId: Uuid;
  primaryAddressId: Uuid | null;
}

async function seedSubscription(input: SeedSubInput): Promise<SeededSub> {
  return withServiceRole("d19 mat-sub seed subscription", async (tx) => {
    const cR = await tx.execute<{ id: Uuid }>(sqlTag`
      INSERT INTO consignees (
        tenant_id, name, phone, address_line, emirate_or_region, district
      ) VALUES (
        ${input.tenantId}, 'Per-Sub Test Consignee',
        ${`phone-${randomUUID().slice(0, 8)}`},
        'Addr', 'Dubai', 'District'
      )
      RETURNING id
    `);
    const consigneeId = cR[0].id;

    let primaryAddressId: Uuid | null = null;
    if (input.primaryAddress !== false) {
      const aR = await tx.execute<{ id: Uuid }>(sqlTag`
        INSERT INTO addresses (
          tenant_id, consignee_id, label, is_primary, line, district, emirate
        ) VALUES (
          ${input.tenantId}, ${consigneeId}, 'home', true,
          'Primary', 'District', 'Dubai'
        )
        RETURNING id
      `);
      primaryAddressId = aR[0].id;
    }

    const dowText = `{${(input.daysOfWeek ?? DOW_MON_FRI).join(",")}}`;
    const sR = await tx.execute<{ id: Uuid }>(sqlTag`
      INSERT INTO subscriptions (
        tenant_id, consignee_id, status,
        start_date, end_date,
        days_of_week, delivery_window_start, delivery_window_end
      ) VALUES (
        ${input.tenantId}, ${consigneeId}, 'active',
        ${SUB_START}, ${SUB_END},
        ${dowText}::integer[],
        '09:00', '11:00'
      )
      RETURNING id
    `);
    return { consigneeId, subscriptionId: sR[0].id, primaryAddressId };
  });
}

async function listSubTasks(
  subscriptionId: Uuid,
): Promise<Array<{ deliveryDate: string; addressId: Uuid | null }>> {
  return withServiceRole("d19 mat-sub list", async (tx) => {
    const rows = await tx.execute<{ d: string; a: Uuid | null }>(sqlTag`
      SELECT delivery_date::text AS d, address_id AS a
      FROM tasks
      WHERE subscription_id = ${subscriptionId}
      ORDER BY delivery_date
    `);
    return rows.map((r) => ({ deliveryDate: r.d, addressId: r.a }));
  });
}

describe("materializeSubscriptionForDateRange (Day-19 / Phase 1 / OQ-2)", () => {
  let tenant: SeededTenant | null = null;
  afterEach(async () => {
    if (tenant) {
      await teardownTenant(tenant.tenantId);
      tenant = null;
    }
  });

  it("happy path — Mon-Fri, 14-day range, materializes 10 tasks against primary address", async () => {
    tenant = await seedTenant("happy");
    const sub = await seedSubscription({ tenantId: tenant.tenantId });

    const result = await withServiceRole("d19 mat-sub run", async (tx) =>
      materializeSubscriptionForDateRange(tx, {
        subscriptionId: sub.subscriptionId,
        startDate: "2099-05-04", // Monday
        endDate: "2099-05-17", // Sunday two weeks later
        requestId: randomUUID(),
      }),
    );

    expect(result.addressResolutionFailedCount).toBe(0);
    // Mon-Fri × 2 weeks = 10 weekday tasks
    expect(result.newInsertedTaskIds.length).toBe(10);
    const tasks = await listSubTasks(sub.subscriptionId);
    expect(tasks.length).toBe(10);
    for (const t of tasks) {
      expect(t.addressId).toBe(sub.primaryAddressId);
    }
  });

  it("idempotent re-run — second invocation produces zero additional inserts", async () => {
    tenant = await seedTenant("idemp");
    const sub = await seedSubscription({ tenantId: tenant.tenantId });

    const first = await withServiceRole("d19 mat-sub run", async (tx) =>
      materializeSubscriptionForDateRange(tx, {
        subscriptionId: sub.subscriptionId,
        startDate: "2099-06-01", // Monday
        endDate: "2099-06-07", // Sunday
        requestId: randomUUID(),
      }),
    );
    expect(first.newInsertedTaskIds.length).toBe(5); // Mon-Fri

    const second = await withServiceRole("d19 mat-sub rerun", async (tx) =>
      materializeSubscriptionForDateRange(tx, {
        subscriptionId: sub.subscriptionId,
        startDate: "2099-06-01",
        endDate: "2099-06-07",
        requestId: randomUUID(),
      }),
    );
    expect(second.newInsertedTaskIds.length).toBe(0);
    expect(second.addressResolutionFailedCount).toBe(0);
  });

  it("edge: startDate == endDate single-day range — 1 task on eligible weekday, 0 on non-eligible", async () => {
    tenant = await seedTenant("single");
    const sub = await seedSubscription({ tenantId: tenant.tenantId });

    // 2099-05-04 is a Monday — eligible
    const monResult = await withServiceRole("d19 mat-sub mon", async (tx) =>
      materializeSubscriptionForDateRange(tx, {
        subscriptionId: sub.subscriptionId,
        startDate: "2099-05-04",
        endDate: "2099-05-04",
        requestId: randomUUID(),
      }),
    );
    expect(monResult.newInsertedTaskIds.length).toBe(1);

    // 2099-05-09 is a Saturday — NOT in Mon-Fri days_of_week
    const satResult = await withServiceRole("d19 mat-sub sat", async (tx) =>
      materializeSubscriptionForDateRange(tx, {
        subscriptionId: sub.subscriptionId,
        startDate: "2099-05-09",
        endDate: "2099-05-09",
        requestId: randomUUID(),
      }),
    );
    expect(satResult.newInsertedTaskIds.length).toBe(0);
    expect(satResult.addressResolutionFailedCount).toBe(0);
  });

  it("edge: range > 30 days — 6 weeks Mon-Fri = 30 tasks", async () => {
    tenant = await seedTenant("long");
    const sub = await seedSubscription({ tenantId: tenant.tenantId });

    // 2099-07-06 (Mon) through 2099-08-16 (Sun) = 42 days; 6 weeks
    // Mon-Fri = 30 tasks
    const result = await withServiceRole("d19 mat-sub long", async (tx) =>
      materializeSubscriptionForDateRange(tx, {
        subscriptionId: sub.subscriptionId,
        startDate: "2099-07-06",
        endDate: "2099-08-16",
        requestId: randomUUID(),
      }),
    );

    expect(result.newInsertedTaskIds.length).toBe(30);
    expect(result.addressResolutionFailedCount).toBe(0);
  });

  it("address resolution failure — no primary, no rotation, no override → 0 inserted, count surfaces", async () => {
    tenant = await seedTenant("noaddr");
    const sub = await seedSubscription({
      tenantId: tenant.tenantId,
      primaryAddress: false,
    });

    const result = await withServiceRole("d19 mat-sub noaddr", async (tx) =>
      materializeSubscriptionForDateRange(tx, {
        subscriptionId: sub.subscriptionId,
        startDate: "2099-09-07", // Monday
        endDate: "2099-09-13", // Sunday
        requestId: randomUUID(),
      }),
    );

    expect(result.newInsertedTaskIds.length).toBe(0);
    // Mon-Fri × 1 week = 5 quarantined tuples
    expect(result.addressResolutionFailedCount).toBe(5);
    const tasks = await listSubTasks(sub.subscriptionId);
    expect(tasks.length).toBe(0);
  });
});
