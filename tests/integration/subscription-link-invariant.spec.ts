// tests/integration/subscription-link-invariant.spec.ts
// =============================================================================
// S-2 — schema-layer integrity tests for the tasks ↔ subscriptions link
// from 0010_task_subscription_link.sql.
//
// What this test proves:
//   The composite CHECK `tasks_creation_source_invariant` enforces the
//   bind between `created_via` and `subscription_id`:
//     - created_via='subscription'    requires subscription_id IS NOT NULL
//     - created_via='migration_import' or 'manual_admin' requires subscription_id IS NULL
//   Plus the column-level value-domain CHECK on created_via, the
//   default-value behaviour, and the ON DELETE SET NULL ↔ CHECK
//   interaction (an emergent block on subscription deletion).
//
// Why this lives in its own file:
//   Same separation as task-packages-tenant-match.spec.ts and
//   subscription-check-constraints.spec.ts — the row-level integrity
//   check is a different mechanism from RLS, and rls-tenant-isolation.spec.ts
//   is the regression suite for the policy form specifically.
//
// Why this connects directly via `postgres-js` rather than withServiceRole:
//   Same reasoning as the canary block in rls-tenant-isolation.spec.ts —
//   the point is to demonstrate that the constraint fires at the schema
//   layer regardless of caller. CHECK rejections come from the engine,
//   not the application wrapper.
//
// ON DELETE SET NULL emergent behaviour (counter-reviewer ask):
//   The brief specifies ON DELETE SET NULL on tasks.subscription_id.
//   Combined with the composite CHECK, this means: deleting a subscription
//   that has any tasks with created_via='subscription' will FAIL — the
//   cascade-set-null operation tries to set subscription_id=NULL on those
//   rows, but the CHECK requires created_via='subscription' rows to have
//   subscription_id IS NOT NULL. PostgreSQL aborts the parent DELETE.
//
//   This matches the design intent (subscriptions go to status='ended',
//   not row deletion). Test below pins the empirical behaviour.
//
// Determinism:
//   Random per-run UUIDs.
// =============================================================================

import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("S-2 — tasks ↔ subscriptions link CHECK invariant fires at the schema layer", () => {
  const RUN_ID = randomUUID().slice(0, 8);
  const TENANT_A = randomUUID();
  const SLUG_A = `s2-link-${RUN_ID}-a`;
  const CONSIGNEE_PHONE = `s2-link-${RUN_ID}-1`;

  let sql: ReturnType<typeof postgres>;
  let consigneeId: string;
  let subscriptionId: string;

  beforeAll(async () => {
    const url = process.env.SUPABASE_DATABASE_URL;
    if (!url) {
      throw new Error(
        "SUPABASE_DATABASE_URL must be set for the S-2 invariant test — direct connection bypasses the application wrapper to verify the schema layer enforces invariants on its own"
      );
    }
    sql = postgres(url, { prepare: false, max: 1 });

    const role = await sql<{ role: string; bypassrls: boolean }[]>`
      SELECT current_user AS role, rolbypassrls AS bypassrls
      FROM pg_roles
      WHERE rolname = current_user
    `;
    expect(role[0].bypassrls).toBe(true);

    // Tenant + consignee + one subscription as test-fixture parents.
    await sql`
      INSERT INTO tenants (id, slug, name) VALUES
        (${TENANT_A}, ${SLUG_A}, 'S-2 Link Test Tenant')
    `;

    const consignees = await sql<{ id: string }[]>`
      INSERT INTO consignees (
        tenant_id, name, phone, address_line, emirate_or_region
      ) VALUES (
        ${TENANT_A}, 'S-2 Link Consignee', ${CONSIGNEE_PHONE},
        'Test Address', 'Dubai'
      )
      RETURNING id
    `;
    consigneeId = consignees[0].id;

    const subscriptions = await sql<{ id: string }[]>`
      INSERT INTO subscriptions (
        tenant_id, consignee_id,
        start_date, days_of_week,
        delivery_window_start, delivery_window_end
      ) VALUES (
        ${TENANT_A}, ${consigneeId},
        '2026-05-01', ${[1, 3, 5]},
        '14:00', '16:00'
      )
      RETURNING id
    `;
    subscriptionId = subscriptions[0].id;
  });

  afterAll(async () => {
    if (sql) {
      try {
        await sql`DELETE FROM tasks         WHERE tenant_id = ${TENANT_A}`;
        await sql`DELETE FROM subscriptions WHERE tenant_id = ${TENANT_A}`;
        await sql`DELETE FROM consignees    WHERE tenant_id = ${TENANT_A}`;
        await sql`DELETE FROM tenants       WHERE id = ${TENANT_A}`;
      } catch {
        // Cleanup failure is not test failure.
      }
      await sql.end({ timeout: 2 });
    }
  });

  // ---------------------------------------------------------------------------
  // Composite CHECK — the three brief scenarios
  // ---------------------------------------------------------------------------

  it("REJECTS bad-NULL: created_via='subscription' with subscription_id NULL", async () => {
    await expect(sql`
      INSERT INTO tasks (
        tenant_id, consignee_id, customer_order_number,
        delivery_date, delivery_start_time, delivery_end_time,
        created_via, subscription_id
      ) VALUES (
        ${TENANT_A}, ${consigneeId}, ${`S2-BAD-NULL-${RUN_ID}`},
        '2026-05-01', '14:00', '16:00',
        'subscription', NULL
      )
    `).rejects.toMatchObject({
      message: expect.stringMatching(/tasks_creation_source_invariant/),
    });
  });

  it("REJECTS bad-non-subscription-with-id: created_via='migration_import' with subscription_id set", async () => {
    await expect(sql`
      INSERT INTO tasks (
        tenant_id, consignee_id, customer_order_number,
        delivery_date, delivery_start_time, delivery_end_time,
        created_via, subscription_id
      ) VALUES (
        ${TENANT_A}, ${consigneeId}, ${`S2-BAD-MIG-${RUN_ID}`},
        '2026-05-01', '14:00', '16:00',
        'migration_import', ${subscriptionId}
      )
    `).rejects.toMatchObject({
      message: expect.stringMatching(/tasks_creation_source_invariant/),
    });
  });

  it("ACCEPTS good-subscription-with-id: created_via='subscription' with subscription_id set", async () => {
    const rows = await sql<{ id: string; created_via: string; subscription_id: string }[]>`
      INSERT INTO tasks (
        tenant_id, consignee_id, customer_order_number,
        delivery_date, delivery_start_time, delivery_end_time,
        created_via, subscription_id
      ) VALUES (
        ${TENANT_A}, ${consigneeId}, ${`S2-GOOD-SUB-${RUN_ID}`},
        '2026-05-01', '14:00', '16:00',
        'subscription', ${subscriptionId}
      )
      RETURNING id, created_via, subscription_id
    `;
    expect(rows.length).toBe(1);
    expect(rows[0].created_via).toBe("subscription");
    expect(rows[0].subscription_id).toBe(subscriptionId);
  });

  // ---------------------------------------------------------------------------
  // Boundary cases for the other two created_via values
  // ---------------------------------------------------------------------------

  it("ACCEPTS good-manual-admin: created_via='manual_admin' with subscription_id NULL", async () => {
    const rows = await sql<{ id: string; created_via: string; subscription_id: string | null }[]>`
      INSERT INTO tasks (
        tenant_id, consignee_id, customer_order_number,
        delivery_date, delivery_start_time, delivery_end_time,
        created_via
      ) VALUES (
        ${TENANT_A}, ${consigneeId}, ${`S2-GOOD-MANUAL-${RUN_ID}`},
        '2026-05-01', '14:00', '16:00',
        'manual_admin'
      )
      RETURNING id, created_via, subscription_id
    `;
    expect(rows.length).toBe(1);
    expect(rows[0].created_via).toBe("manual_admin");
    expect(rows[0].subscription_id).toBeNull();
  });

  it("ACCEPTS good-migration-import: created_via='migration_import' with subscription_id NULL", async () => {
    const rows = await sql<{ id: string; created_via: string; subscription_id: string | null }[]>`
      INSERT INTO tasks (
        tenant_id, consignee_id, customer_order_number,
        delivery_date, delivery_start_time, delivery_end_time,
        created_via
      ) VALUES (
        ${TENANT_A}, ${consigneeId}, ${`S2-GOOD-MIG-${RUN_ID}`},
        '2026-05-01', '14:00', '16:00',
        'migration_import'
      )
      RETURNING id, created_via, subscription_id
    `;
    expect(rows.length).toBe(1);
    expect(rows[0].created_via).toBe("migration_import");
    expect(rows[0].subscription_id).toBeNull();
  });

  it("REJECTS manual_admin with subscription_id set (bad-non-subscription-with-id sibling)", async () => {
    await expect(sql`
      INSERT INTO tasks (
        tenant_id, consignee_id, customer_order_number,
        delivery_date, delivery_start_time, delivery_end_time,
        created_via, subscription_id
      ) VALUES (
        ${TENANT_A}, ${consigneeId}, ${`S2-BAD-MANUAL-${RUN_ID}`},
        '2026-05-01', '14:00', '16:00',
        'manual_admin', ${subscriptionId}
      )
    `).rejects.toMatchObject({
      message: expect.stringMatching(/tasks_creation_source_invariant/),
    });
  });

  // ---------------------------------------------------------------------------
  // Column-level value-domain CHECK on created_via
  // ---------------------------------------------------------------------------

  it("REJECTS created_via outside the closed enum", async () => {
    await expect(sql`
      INSERT INTO tasks (
        tenant_id, consignee_id, customer_order_number,
        delivery_date, delivery_start_time, delivery_end_time,
        created_via
      ) VALUES (
        ${TENANT_A}, ${consigneeId}, ${`S2-BAD-ENUM-${RUN_ID}`},
        '2026-05-01', '14:00', '16:00',
        'invalid_value'
      )
    `).rejects.toMatchObject({
      message: expect.stringMatching(/tasks_created_via_check/),
    });
  });

  it("DEFAULTS created_via to 'subscription' when omitted (default-value behaviour)", async () => {
    // With the default + a subscription_id provided, the composite CHECK
    // passes. This pins the production-path assumption: cron callers
    // pass subscription_id and let the default cover created_via.
    const rows = await sql<{ created_via: string }[]>`
      INSERT INTO tasks (
        tenant_id, consignee_id, customer_order_number,
        delivery_date, delivery_start_time, delivery_end_time,
        subscription_id
      ) VALUES (
        ${TENANT_A}, ${consigneeId}, ${`S2-DEFAULT-${RUN_ID}`},
        '2026-05-01', '14:00', '16:00',
        ${subscriptionId}
      )
      RETURNING created_via
    `;
    expect(rows[0].created_via).toBe("subscription");
  });

  // ---------------------------------------------------------------------------
  // ON DELETE SET NULL ↔ CHECK invariant — emergent block
  // ---------------------------------------------------------------------------

  it("ON DELETE SET NULL on a subscription with active subscription-tasks FAILS via CHECK violation", async () => {
    // Setup: dedicated subscription + one subscription-task pinned to it.
    // We do this in-test (rather than in beforeAll) so the deletion
    // doesn't touch the shared subscription used by other cases.
    const subs = await sql<{ id: string }[]>`
      INSERT INTO subscriptions (
        tenant_id, consignee_id,
        start_date, days_of_week,
        delivery_window_start, delivery_window_end
      ) VALUES (
        ${TENANT_A}, ${consigneeId},
        '2026-06-01', ${[2, 4]},
        '09:00', '11:00'
      )
      RETURNING id
    `;
    const ephemeralSubId = subs[0].id;

    await sql`
      INSERT INTO tasks (
        tenant_id, consignee_id, customer_order_number,
        delivery_date, delivery_start_time, delivery_end_time,
        created_via, subscription_id
      ) VALUES (
        ${TENANT_A}, ${consigneeId}, ${`S2-EPHEMERAL-TASK-${RUN_ID}`},
        '2026-06-02', '09:00', '11:00',
        'subscription', ${ephemeralSubId}
      )
    `;

    // The deletion. ON DELETE SET NULL would try to clear the child task's
    // subscription_id. That violates the composite CHECK
    // (created_via='subscription' requires subscription_id IS NOT NULL),
    // so PostgreSQL aborts the DELETE.
    await expect(sql`
      DELETE FROM subscriptions WHERE id = ${ephemeralSubId}
    `).rejects.toMatchObject({
      message: expect.stringMatching(/tasks_creation_source_invariant/),
    });

    // Sanity check: the subscription still exists (DELETE was aborted).
    const stillThere = await sql<{ id: string }[]>`
      SELECT id FROM subscriptions WHERE id = ${ephemeralSubId}
    `;
    expect(stillThere.length).toBe(1);
  });

  it("ON DELETE SET NULL on an empty subscription succeeds (no children, no CHECK violation)", async () => {
    // Boundary case: a subscription with NO tasks can be deleted directly.
    // ON DELETE SET NULL has nothing to cascade, so the CHECK doesn't fire.
    // This is the "deletion is rare but not blocked" case from the brief.
    const subs = await sql<{ id: string }[]>`
      INSERT INTO subscriptions (
        tenant_id, consignee_id,
        start_date, days_of_week,
        delivery_window_start, delivery_window_end
      ) VALUES (
        ${TENANT_A}, ${consigneeId},
        '2026-07-01', ${[5]},
        '12:00', '14:00'
      )
      RETURNING id
    `;
    const emptySubId = subs[0].id;

    await sql`DELETE FROM subscriptions WHERE id = ${emptySubId}`;

    const after = await sql<{ id: string }[]>`
      SELECT id FROM subscriptions WHERE id = ${emptySubId}
    `;
    expect(after.length).toBe(0);
  });
});
