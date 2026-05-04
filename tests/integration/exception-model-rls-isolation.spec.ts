// tests/integration/exception-model-rls-isolation.spec.ts
// =============================================================================
// Day 13 / T3 part 1 — RLS isolation regression tests for the seven new
// tenant-scoped surfaces from PLANNER_PRODUCT_BRIEF.md §3.4 + plan §5.3.
//
// Surfaces covered (all RLS-enabled in 0014/0015/0016/0018):
//   1. addresses
//   2. subscription_address_rotations
//   3. subscription_exceptions
//   4. subscription_materialization
//   5. consignee_crm_events
//   6. webhook_events
//   7. consignee_timeline_events (VIEW — RLS inherits from underlying tables)
//
// Pattern mirrors tests/integration/rls-tenant-isolation.spec.ts:
//   - withTenant(A) sees only A's rows
//   - withTenant(B) sees only B's rows
//   - withServiceRole sees both
//
// Determinism: random per-run UUIDs. Same audit-rule cascade conflict
// considerations as the precedent file (memory/followup_audit_rule_cascade_conflict.md).
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { withServiceRole, withTenant } from "../../src/shared/db";

type CountRow = { n: number } & Record<string, unknown>;

describe("Day 13 / T3 part 1 — exception-model RLS isolation", () => {
  const RUN_ID = randomUUID().slice(0, 8);
  const TENANT_A = randomUUID();
  const TENANT_B = randomUUID();
  const SLUG_A = `d13-rls-${RUN_ID}-a`;
  const SLUG_B = `d13-rls-${RUN_ID}-b`;

  // Per-tenant fixtures populated in beforeAll.
  let consigneeA = "";
  let consigneeB = "";
  let subscriptionA = "";
  let subscriptionB = "";
  let addressA = "";
  let addressB = "";

  beforeAll(async () => {
    await withServiceRole("D13 part1 RLS test setup — tenants + parents", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name) VALUES
          (${TENANT_A}, ${SLUG_A}, 'D13 RLS Test A'),
          (${TENANT_B}, ${SLUG_B}, 'D13 RLS Test B')
      `);

      const consA = await tx.execute<{ id: string } & Record<string, unknown>>(sqlTag`
        INSERT INTO consignees (
          tenant_id, name, phone, address_line, emirate_or_region, district
        ) VALUES (
          ${TENANT_A}, 'D13 Consignee A', ${`d13-rls-${RUN_ID}-a-phone`},
          'Test Addr A', 'Dubai', 'Test District A'
        ) RETURNING id
      `);
      consigneeA = consA[0].id;

      const consB = await tx.execute<{ id: string } & Record<string, unknown>>(sqlTag`
        INSERT INTO consignees (
          tenant_id, name, phone, address_line, emirate_or_region, district
        ) VALUES (
          ${TENANT_B}, 'D13 Consignee B', ${`d13-rls-${RUN_ID}-b-phone`},
          'Test Addr B', 'Dubai', 'Test District B'
        ) RETURNING id
      `);
      consigneeB = consB[0].id;

      const subA = await tx.execute<{ id: string } & Record<string, unknown>>(sqlTag`
        INSERT INTO subscriptions (
          tenant_id, consignee_id,
          start_date, days_of_week,
          delivery_window_start, delivery_window_end
        ) VALUES (
          ${TENANT_A}, ${consigneeA},
          '2026-05-01', '{1,2,3,4,5}'::int[],
          '14:00', '16:00'
        ) RETURNING id
      `);
      subscriptionA = subA[0].id;

      const subB = await tx.execute<{ id: string } & Record<string, unknown>>(sqlTag`
        INSERT INTO subscriptions (
          tenant_id, consignee_id,
          start_date, days_of_week,
          delivery_window_start, delivery_window_end
        ) VALUES (
          ${TENANT_B}, ${consigneeB},
          '2026-05-01', '{1,2,3,4,5}'::int[],
          '14:00', '16:00'
        ) RETURNING id
      `);
      subscriptionB = subB[0].id;

      const addrA = await tx.execute<{ id: string } & Record<string, unknown>>(sqlTag`
        INSERT INTO addresses (
          consignee_id, tenant_id, label, is_primary,
          line, district, emirate
        ) VALUES (
          ${consigneeA}, ${TENANT_A}, 'home', true,
          'Test Line A', 'Test District A', 'Dubai'
        ) RETURNING id
      `);
      addressA = addrA[0].id;

      const addrB = await tx.execute<{ id: string } & Record<string, unknown>>(sqlTag`
        INSERT INTO addresses (
          consignee_id, tenant_id, label, is_primary,
          line, district, emirate
        ) VALUES (
          ${consigneeB}, ${TENANT_B}, 'home', true,
          'Test Line B', 'Test District B', 'Dubai'
        ) RETURNING id
      `);
      addressB = addrB[0].id;

      // Seed one row in each net-new tenant-scoped surface for both tenants.
      // subscription_address_rotations
      await tx.execute(sqlTag`
        INSERT INTO subscription_address_rotations
          (subscription_id, tenant_id, weekday, address_id)
        VALUES
          (${subscriptionA}, ${TENANT_A}, 1, ${addressA}),
          (${subscriptionB}, ${TENANT_B}, 1, ${addressB})
      `);

      // subscription_exceptions — type='skip' for both
      const correlationA = randomUUID();
      const correlationB = randomUUID();
      const idemA = randomUUID();
      const idemB = randomUUID();
      const actorA = randomUUID();
      const actorB = randomUUID();
      await tx.execute(sqlTag`
        INSERT INTO subscription_exceptions
          (subscription_id, tenant_id, type, start_date,
           correlation_id, idempotency_key, created_by)
        VALUES
          (${subscriptionA}, ${TENANT_A}, 'skip', '2026-05-06',
           ${correlationA}, ${idemA}, ${actorA}),
          (${subscriptionB}, ${TENANT_B}, 'skip', '2026-05-06',
           ${correlationB}, ${idemB}, ${actorB})
      `);

      // subscription_materialization
      await tx.execute(sqlTag`
        INSERT INTO subscription_materialization
          (subscription_id, tenant_id, materialized_through_date)
        VALUES
          (${subscriptionA}, ${TENANT_A}, '2026-05-18'),
          (${subscriptionB}, ${TENANT_B}, '2026-05-18')
      `);

      // consignee_crm_events
      await tx.execute(sqlTag`
        INSERT INTO consignee_crm_events
          (consignee_id, tenant_id, from_state, to_state, reason, actor)
        VALUES
          (${consigneeA}, ${TENANT_A}, 'ACTIVE', 'HIGH_RISK', 'rls test',
           ${randomUUID()}),
          (${consigneeB}, ${TENANT_B}, 'ACTIVE', 'HIGH_RISK', 'rls test',
           ${randomUUID()})
      `);

      // webhook_events — distinct (suitefleet_task_id, action, event_timestamp)
      // tuples per tenant so the dedup UNIQUE doesn't collide.
      await tx.execute(sqlTag`
        INSERT INTO webhook_events
          (tenant_id, suitefleet_task_id, action, event_timestamp, raw_payload)
        VALUES
          (${TENANT_A}, ${`d13-rls-${RUN_ID}-task-A`},
           'TASK_HAS_BEEN_ORDERED', '2026-05-04T12:00:00Z'::timestamptz,
           '{"test":"A"}'::jsonb),
          (${TENANT_B}, ${`d13-rls-${RUN_ID}-task-B`},
           'TASK_HAS_BEEN_ORDERED', '2026-05-04T12:00:00Z'::timestamptz,
           '{"test":"B"}'::jsonb)
      `);
    });
  });

  afterAll(async () => {
    // Best-effort cleanup. ON DELETE CASCADE on tenants + consignees +
    // subscriptions handles the dependent rows.
    try {
      await withServiceRole("D13 part1 RLS test cleanup", async (tx) => {
        await tx.execute(sqlTag`DELETE FROM tenants WHERE id IN (${TENANT_A}, ${TENANT_B})`);
      });
    } catch {
      // Cleanup failure is not test failure.
    }
  });

  // ---------------------------------------------------------------------------
  // Per-table RLS isolation. Each test asserts withTenant(A) sees only A's
  // row, withTenant(B) sees only B's row, withServiceRole sees both. All
  // counts are scoped to the test-seeded rows (by tenant_id IN the test
  // pair) so leftover rows from prior test runs don't inflate the count.
  // ---------------------------------------------------------------------------

  async function expectIsolated(
    table: string,
    tenantPredicate: string, // SQL fragment matching `tenant_id = $1` or similar
  ): Promise<void> {
    const countA = await withTenant(TENANT_A, async (tx) => {
      const rows = await tx.execute<CountRow>(
        sqlTag.raw(
          `SELECT count(*)::int AS n FROM ${table} WHERE ${tenantPredicate}`,
        ),
      );
      return rows[0]?.n ?? 0;
    });
    expect(countA).toBe(1);

    const countB = await withTenant(TENANT_B, async (tx) => {
      const rows = await tx.execute<CountRow>(
        sqlTag.raw(
          `SELECT count(*)::int AS n FROM ${table} WHERE ${tenantPredicate}`,
        ),
      );
      return rows[0]?.n ?? 0;
    });
    expect(countB).toBe(1);

    const countSR = await withServiceRole("D13 part1 RLS verify both", async (tx) => {
      const rows = await tx.execute<CountRow>(
        sqlTag.raw(
          `SELECT count(*)::int AS n FROM ${table} WHERE ${tenantPredicate}`,
        ),
      );
      return rows[0]?.n ?? 0;
    });
    expect(countSR).toBe(2);
  }

  it("table addresses — RLS isolates per tenant", async () => {
    await expectIsolated("addresses", `tenant_id IN ('${TENANT_A}', '${TENANT_B}')`);
  });

  it("table subscription_address_rotations — RLS isolates per tenant", async () => {
    await expectIsolated(
      "subscription_address_rotations",
      `tenant_id IN ('${TENANT_A}', '${TENANT_B}')`,
    );
  });

  it("table subscription_exceptions — RLS isolates per tenant", async () => {
    await expectIsolated(
      "subscription_exceptions",
      `tenant_id IN ('${TENANT_A}', '${TENANT_B}')`,
    );
  });

  it("table subscription_materialization — RLS isolates per tenant", async () => {
    await expectIsolated(
      "subscription_materialization",
      `tenant_id IN ('${TENANT_A}', '${TENANT_B}')`,
    );
  });

  it("table consignee_crm_events — RLS isolates per tenant", async () => {
    await expectIsolated(
      "consignee_crm_events",
      `tenant_id IN ('${TENANT_A}', '${TENANT_B}')`,
    );
  });

  it("webhook_events — withTenant(A) sees only A's row, withTenant(B) only B's", async () => {
    // Separate test from the it.each block because webhook_events does
    // not yet have an INSERT path through service code in part 1; the
    // direct insert in beforeAll seeded it. The RLS check is the same
    // shape.
    const countA = await withTenant(TENANT_A, async (tx) => {
      const rows = await tx.execute<CountRow>(sqlTag`
        SELECT count(*)::int AS n FROM webhook_events
        WHERE suitefleet_task_id LIKE ${`d13-rls-${RUN_ID}-task-%`}
      `);
      return rows[0]?.n ?? 0;
    });
    expect(countA).toBe(1);

    const countB = await withTenant(TENANT_B, async (tx) => {
      const rows = await tx.execute<CountRow>(sqlTag`
        SELECT count(*)::int AS n FROM webhook_events
        WHERE suitefleet_task_id LIKE ${`d13-rls-${RUN_ID}-task-%`}
      `);
      return rows[0]?.n ?? 0;
    });
    expect(countB).toBe(1);

    const countSR = await withServiceRole("D13 part1 webhook_events verify", async (tx) => {
      const rows = await tx.execute<CountRow>(sqlTag`
        SELECT count(*)::int AS n FROM webhook_events
        WHERE suitefleet_task_id LIKE ${`d13-rls-${RUN_ID}-task-%`}
      `);
      return rows[0]?.n ?? 0;
    });
    expect(countSR).toBe(2);
  });

  it("consignee_timeline_events VIEW — RLS inherits from underlying tables", async () => {
    // The view is SECURITY INVOKER (default). Underlying RLS on
    // consignee_crm_events / subscription_exceptions / tasks applies
    // automatically. We seeded one consignee_crm_events row per tenant
    // in beforeAll; the view should return one row per tenant under
    // withTenant(A) and withTenant(B).
    //
    // The view also pulls subscription_exceptions (via JOIN to
    // subscriptions for the consignee_id) — we seeded one of those per
    // tenant too. So the expected per-tenant count is 1 (crm) + 1
    // (exception) = 2.

    const countA = await withTenant(TENANT_A, async (tx) => {
      const rows = await tx.execute<CountRow>(sqlTag`
        SELECT count(*)::int AS n FROM consignee_timeline_events
        WHERE consignee_id = ${consigneeA}
      `);
      return rows[0]?.n ?? 0;
    });
    expect(countA).toBe(2);

    const countB = await withTenant(TENANT_B, async (tx) => {
      const rows = await tx.execute<CountRow>(sqlTag`
        SELECT count(*)::int AS n FROM consignee_timeline_events
        WHERE consignee_id = ${consigneeB}
      `);
      return rows[0]?.n ?? 0;
    });
    expect(countB).toBe(1 + 1);

    // Cross-probe: withTenant(B) querying for consignee A's id sees zero.
    const crossProbe = await withTenant(TENANT_B, async (tx) => {
      const rows = await tx.execute<CountRow>(sqlTag`
        SELECT count(*)::int AS n FROM consignee_timeline_events
        WHERE consignee_id = ${consigneeA}
      `);
      return rows[0]?.n ?? 0;
    });
    expect(crossProbe).toBe(0);
  });
});
