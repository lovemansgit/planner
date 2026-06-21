// tests/integration/task-materialization-one-off.spec.ts
//
// D56 / Phase-5 move-to-date rework — integration coverage for
// `materializeSubscriptionOneOffDate` against a live Postgres.
//
// The crux this proves: the one-off primitive inserts a task at a date BEYOND
// the subscription's end_date — which the capped range materializer
// (materializeSubscriptionForDateRange, upper bound LEAST(endDate, end_date))
// cannot do. Move-to-date moves a delivery to a date beyond the schedule end,
// so this no-cap insert is the only way to create the moved task. The contrast
// test runs the range materializer at the same target and asserts it inserts
// nothing.
//
// Pattern mirrors tests/integration/task-materialization-per-sub.spec.ts:
//   - Per-test fresh tenant via random UUID + slug.
//   - withServiceRole for fixture INSERTs + the function calls.
//   - audit-RULE-aware teardown (0002 audit_events_no_delete).
//   - Seeders inline-duplicated per §3.4 cross-module-import prohibition.

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import {
  materializeSubscriptionForDateRange,
  materializeSubscriptionOneOffDate,
} from "@/modules/task-materialization/service";
import { withServiceRole } from "@/shared/db";
import type { Uuid } from "@/shared/types";

const SUB_START = "2099-01-05"; // Monday
const SUB_END = "2099-03-31"; // Tuesday — schedule ends here
const BEYOND_END = "2099-04-06"; // Monday, BEYOND end_date — eligible (Mon-Fri)
const DOW_MON_FRI = [1, 2, 3, 4, 5];

interface SeededTenant {
  tenantId: string;
  slug: string;
}

async function seedTenant(label: string): Promise<SeededTenant> {
  const runId = randomUUID().slice(0, 8);
  const tenantId = randomUUID();
  const slug = `d56-oneoff-${label}-${runId}`;
  await withServiceRole(`d56 one-off seed tenant ${label}`, async (tx) => {
    await tx.execute(sqlTag`
      INSERT INTO tenants (id, slug, name)
      VALUES (${tenantId}, ${slug}, ${`d56 one-off ${label}`})
    `);
  });
  return { tenantId, slug };
}

async function teardownTenant(tenantId: string): Promise<void> {
  // Cleanup wrapped in try/catch — audit_events_no_delete RULE (0002).
  try {
    await withServiceRole("d56 one-off teardown", async (tx) => {
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

interface SeededSub {
  consigneeId: Uuid;
  subscriptionId: Uuid;
  primaryAddressId: Uuid | null;
}

async function seedSubscription(input: {
  tenantId: string;
  primaryAddress?: boolean;
}): Promise<SeededSub> {
  return withServiceRole("d56 one-off seed subscription", async (tx) => {
    const cR = await tx.execute<{ id: Uuid }>(sqlTag`
      INSERT INTO consignees (
        tenant_id, name, phone, address_line, emirate_or_region, district
      ) VALUES (
        ${input.tenantId}, 'One-Off Test Consignee',
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

    const dowText = `{${DOW_MON_FRI.join(",")}}`;
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

async function listSubTaskDates(subscriptionId: Uuid): Promise<string[]> {
  return withServiceRole("d56 one-off list", async (tx) => {
    const rows = await tx.execute<{ d: string }>(sqlTag`
      SELECT delivery_date::text AS d
      FROM tasks
      WHERE subscription_id = ${subscriptionId}
      ORDER BY delivery_date
    `);
    return rows.map((r) => r.d);
  });
}

describe("materializeSubscriptionOneOffDate (D56 / Phase-5)", () => {
  let tenant: SeededTenant | null = null;
  afterEach(async () => {
    if (tenant) {
      await teardownTenant(tenant.tenantId);
      tenant = null;
    }
  });

  it("inserts exactly ONE task at a date BEYOND end_date (the range materializer cannot)", async () => {
    tenant = await seedTenant("beyond");
    const sub = await seedSubscription({ tenantId: tenant.tenantId });

    // The capped range materializer cannot reach beyond end_date: a range that
    // spans the target inserts NOTHING at the target.
    const range = await withServiceRole("d56 one-off range-contrast", async (tx) =>
      materializeSubscriptionForDateRange(tx, {
        subscriptionId: sub.subscriptionId,
        startDate: BEYOND_END,
        endDate: BEYOND_END,
        requestId: randomUUID(),
      }),
    );
    expect(range.newInsertedTaskIds.length).toBe(0);

    // The one-off primitive inserts exactly one task at the beyond-end_date date.
    const oneOff = await withServiceRole("d56 one-off run", async (tx) =>
      materializeSubscriptionOneOffDate(tx, {
        subscriptionId: sub.subscriptionId,
        date: BEYOND_END,
        requestId: randomUUID(),
      }),
    );

    expect(oneOff.addressResolutionFailed).toBe(false);
    expect(oneOff.insertedTaskId).not.toBeNull();

    const dates = await listSubTaskDates(sub.subscriptionId);
    expect(dates).toEqual([BEYOND_END]);
  });

  it("is idempotent — a second one-off at the same date inserts nothing (ON CONFLICT)", async () => {
    tenant = await seedTenant("idemp");
    const sub = await seedSubscription({ tenantId: tenant.tenantId });

    const first = await withServiceRole("d56 one-off first", async (tx) =>
      materializeSubscriptionOneOffDate(tx, {
        subscriptionId: sub.subscriptionId,
        date: BEYOND_END,
        requestId: randomUUID(),
      }),
    );
    expect(first.insertedTaskId).not.toBeNull();

    const second = await withServiceRole("d56 one-off second", async (tx) =>
      materializeSubscriptionOneOffDate(tx, {
        subscriptionId: sub.subscriptionId,
        date: BEYOND_END,
        requestId: randomUUID(),
      }),
    );
    expect(second.insertedTaskId).toBeNull();
    expect(second.addressResolutionFailed).toBe(false);

    const dates = await listSubTaskDates(sub.subscriptionId);
    expect(dates).toEqual([BEYOND_END]); // still exactly one
  });

  it("reports addressResolutionFailed (no insert) when the consignee has no resolvable address", async () => {
    tenant = await seedTenant("nogap");
    const sub = await seedSubscription({ tenantId: tenant.tenantId, primaryAddress: false });

    const result = await withServiceRole("d56 one-off nogap", async (tx) =>
      materializeSubscriptionOneOffDate(tx, {
        subscriptionId: sub.subscriptionId,
        date: BEYOND_END,
        requestId: randomUUID(),
      }),
    );

    expect(result.addressResolutionFailed).toBe(true);
    expect(result.insertedTaskId).toBeNull();
    const dates = await listSubTaskDates(sub.subscriptionId);
    expect(dates).toEqual([]);
  });

  it("produces no candidate row for a non-eligible weekday (returns null, no failure)", async () => {
    tenant = await seedTenant("weekday");
    const sub = await seedSubscription({ tenantId: tenant.tenantId });

    // 2099-04-11 is a Saturday — not in Mon-Fri days_of_week.
    const result = await withServiceRole("d56 one-off weekday", async (tx) =>
      materializeSubscriptionOneOffDate(tx, {
        subscriptionId: sub.subscriptionId,
        date: "2099-04-11",
        requestId: randomUUID(),
      }),
    );

    expect(result.insertedTaskId).toBeNull();
    expect(result.addressResolutionFailed).toBe(false);
    const dates = await listSubTaskDates(sub.subscriptionId);
    expect(dates).toEqual([]);
  });
});
