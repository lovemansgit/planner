// tests/integration/exception-model-check-constraints.spec.ts
// =============================================================================
// Day 13 / T3 part 1 — schema-layer integrity tests for CHECK constraints
// and partial UNIQUE indexes from migrations 0014–0019. Implements
// memory/plans/day-13-exception-model-part-1.md §5.4 + §5.6.
//
// Pattern mirrors tests/integration/subscription-check-constraints.spec.ts:
// direct postgres-js connection (BYPASSRLS) so the constraint enforcement
// is what we're testing, not an application wrapper.
//
// Constraints under test:
//   subscription_exceptions:
//     - subscription_exceptions_type_check
//     - exc_address_override_requires_address_id
//     - exc_pause_window_requires_end_date
//     - exc_skip_without_append_only_for_skip
//     - exc_compensating_date_only_for_skip
//     - subscription_exceptions_idempotency_idx UNIQUE
//   addresses:
//     - addresses_label_check
//     - addresses_one_primary_per_consignee_idx partial UNIQUE
//   subscription_address_rotations:
//     - subscription_address_rotations_weekday_check
//     - subscription_address_rotations_sub_weekday_idx UNIQUE
//   consignees:
//     - consignees_crm_state_check
//   webhook_events:
//     - webhook_events_dedup_idx UNIQUE
//   tasks (extended):
//     - tasks_internal_status_check accepts SKIPPED; rejects unknown
//   tasks.address_id (§5.6):
//     - accepts NULL (column-add nullable per §1.3.1)
//     - accepts valid addresses.id (FK ok)
//     - rejects random uuid (FK violation 23503)
//     - DELETE FROM addresses for an in-use address rejects (ON DELETE
//       RESTRICT, 23503)
//
// =============================================================================

import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("Day 13 / T3 part 1 — exception-model CHECK constraints + UNIQUEs", () => {
  const RUN_ID = randomUUID().slice(0, 8);
  const TENANT_A = randomUUID();
  const SLUG_A = `d13-check-${RUN_ID}`;

  let sql: ReturnType<typeof postgres>;
  let consigneeId = "";
  let subscriptionId = "";
  let addressId = "";

  beforeAll(async () => {
    const url = process.env.SUPABASE_DATABASE_URL;
    if (!url) {
      throw new Error(
        "SUPABASE_DATABASE_URL must be set for the D13 part-1 CHECK constraint test " +
          "— direct connection bypasses the application wrapper to verify the schema layer.",
      );
    }
    sql = postgres(url, { prepare: false, max: 1 });

    // Sanity: must be the BYPASSRLS connection.
    const role = await sql<{ bypassrls: boolean }[]>`
      SELECT rolbypassrls AS bypassrls
      FROM pg_roles
      WHERE rolname = current_user
    `;
    expect(role[0].bypassrls).toBe(true);

    await sql`
      INSERT INTO tenants (id, slug, name) VALUES
        (${TENANT_A}, ${SLUG_A}, 'D13 CHECK Test')
    `;

    const cons = await sql<{ id: string }[]>`
      INSERT INTO consignees (
        tenant_id, name, phone, address_line, emirate_or_region, district
      ) VALUES (
        ${TENANT_A}, 'D13 CHECK Consignee', ${`d13-check-${RUN_ID}-phone`},
        'Test Addr', 'Dubai', 'Test District'
      ) RETURNING id
    `;
    consigneeId = cons[0].id;

    const sub = await sql<{ id: string }[]>`
      INSERT INTO subscriptions (
        tenant_id, consignee_id,
        start_date, days_of_week,
        delivery_window_start, delivery_window_end
      ) VALUES (
        ${TENANT_A}, ${consigneeId},
        '2026-05-01', ${[1, 2, 3, 4, 5]},
        '14:00', '16:00'
      ) RETURNING id
    `;
    subscriptionId = sub[0].id;

    const addr = await sql<{ id: string }[]>`
      INSERT INTO addresses (
        consignee_id, tenant_id, label, is_primary,
        line, district, emirate
      ) VALUES (
        ${consigneeId}, ${TENANT_A}, 'home', true,
        'Test Line', 'Test District', 'Dubai'
      ) RETURNING id
    `;
    addressId = addr[0].id;
  });

  afterAll(async () => {
    if (sql) {
      try {
        // Cascade from tenants handles dependents.
        await sql`DELETE FROM tenants WHERE id = ${TENANT_A}`;
      } catch {
        // Cleanup failure is not test failure.
      }
      await sql.end({ timeout: 2 });
    }
  });

  // ---------------------------------------------------------------------------
  // subscription_exceptions
  // ---------------------------------------------------------------------------

  it("subscription_exceptions_type_check rejects unknown type", async () => {
    await expect(sql`
      INSERT INTO subscription_exceptions (
        subscription_id, tenant_id, type, start_date,
        correlation_id, idempotency_key, created_by
      ) VALUES (
        ${subscriptionId}, ${TENANT_A}, 'unknown_type', '2026-05-06',
        ${randomUUID()}, ${randomUUID()}, ${randomUUID()}
      )
    `).rejects.toMatchObject({
      message: expect.stringMatching(/subscription_exceptions_type_check/),
    });
  });

  it("exc_address_override_requires_address_id rejects address override without address_id", async () => {
    await expect(sql`
      INSERT INTO subscription_exceptions (
        subscription_id, tenant_id, type, start_date,
        correlation_id, idempotency_key, created_by
      ) VALUES (
        ${subscriptionId}, ${TENANT_A}, 'address_override_one_off', '2026-05-06',
        ${randomUUID()}, ${randomUUID()}, ${randomUUID()}
      )
    `).rejects.toMatchObject({
      message: expect.stringMatching(/exc_address_override_requires_address_id/),
    });
  });

  it("exc_address_override_requires_address_id accepts address override WITH address_id", async () => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO subscription_exceptions (
        subscription_id, tenant_id, type, start_date,
        address_override_id,
        correlation_id, idempotency_key, created_by
      ) VALUES (
        ${subscriptionId}, ${TENANT_A}, 'address_override_one_off', '2026-05-07',
        ${addressId},
        ${randomUUID()}, ${randomUUID()}, ${randomUUID()}
      ) RETURNING id
    `;
    expect(rows.length).toBe(1);
  });

  it("exc_pause_window_requires_end_date rejects pause_window without end_date", async () => {
    await expect(sql`
      INSERT INTO subscription_exceptions (
        subscription_id, tenant_id, type, start_date,
        correlation_id, idempotency_key, created_by
      ) VALUES (
        ${subscriptionId}, ${TENANT_A}, 'pause_window', '2026-05-08',
        ${randomUUID()}, ${randomUUID()}, ${randomUUID()}
      )
    `).rejects.toMatchObject({
      message: expect.stringMatching(/exc_pause_window_requires_end_date/),
    });
  });

  it("exc_skip_without_append_only_for_skip rejects flag with non-skip type", async () => {
    await expect(sql`
      INSERT INTO subscription_exceptions (
        subscription_id, tenant_id, type, start_date, end_date,
        skip_without_append,
        correlation_id, idempotency_key, created_by
      ) VALUES (
        ${subscriptionId}, ${TENANT_A}, 'pause_window',
        '2026-05-09', '2026-05-12',
        true,
        ${randomUUID()}, ${randomUUID()}, ${randomUUID()}
      )
    `).rejects.toMatchObject({
      message: expect.stringMatching(/exc_skip_without_append_only_for_skip/),
    });
  });

  it("exc_compensating_date_only_for_skip rejects compensating_date with non-skip type", async () => {
    await expect(sql`
      INSERT INTO subscription_exceptions (
        subscription_id, tenant_id, type, start_date, end_date,
        compensating_date,
        correlation_id, idempotency_key, created_by
      ) VALUES (
        ${subscriptionId}, ${TENANT_A}, 'pause_window',
        '2026-05-13', '2026-05-15',
        '2026-05-20',
        ${randomUUID()}, ${randomUUID()}, ${randomUUID()}
      )
    `).rejects.toMatchObject({
      message: expect.stringMatching(/exc_compensating_date_only_for_skip/),
    });
  });

  it("subscription_exceptions_idempotency_idx UNIQUE catches duplicate (subscription_id, idempotency_key)", async () => {
    const sharedKey = randomUUID();
    await sql`
      INSERT INTO subscription_exceptions (
        subscription_id, tenant_id, type, start_date,
        correlation_id, idempotency_key, created_by
      ) VALUES (
        ${subscriptionId}, ${TENANT_A}, 'skip', '2026-06-01',
        ${randomUUID()}, ${sharedKey}, ${randomUUID()}
      )
    `;
    await expect(sql`
      INSERT INTO subscription_exceptions (
        subscription_id, tenant_id, type, start_date,
        correlation_id, idempotency_key, created_by
      ) VALUES (
        ${subscriptionId}, ${TENANT_A}, 'skip', '2026-06-02',
        ${randomUUID()}, ${sharedKey}, ${randomUUID()}
      )
    `).rejects.toMatchObject({
      message: expect.stringMatching(/subscription_exceptions_idempotency_idx/),
    });
  });

  // ---------------------------------------------------------------------------
  // addresses
  // ---------------------------------------------------------------------------

  it("addresses_label_check rejects unknown label", async () => {
    await expect(sql`
      INSERT INTO addresses (
        consignee_id, tenant_id, label, is_primary,
        line, district, emirate
      ) VALUES (
        ${consigneeId}, ${TENANT_A}, 'invalid_label', false,
        'X', 'Y', 'Z'
      )
    `).rejects.toMatchObject({
      message: expect.stringMatching(/addresses_label_check/),
    });
  });

  it("addresses_one_primary_per_consignee_idx — second primary for same consignee rejects (partial UNIQUE)", async () => {
    // beforeAll already inserted one is_primary=true for consigneeId.
    await expect(sql`
      INSERT INTO addresses (
        consignee_id, tenant_id, label, is_primary,
        line, district, emirate
      ) VALUES (
        ${consigneeId}, ${TENANT_A}, 'office', true,
        'Office Line', 'Office District', 'Dubai'
      )
    `).rejects.toMatchObject({
      message: expect.stringMatching(/addresses_one_primary_per_consignee_idx/),
    });
  });

  it("addresses_one_primary_per_consignee_idx — second non-primary for same consignee accepts (partial WHERE clause)", async () => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO addresses (
        consignee_id, tenant_id, label, is_primary,
        line, district, emirate
      ) VALUES (
        ${consigneeId}, ${TENANT_A}, 'office', false,
        'Office Line 2', 'Office District 2', 'Dubai'
      ) RETURNING id
    `;
    expect(rows.length).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // subscription_address_rotations
  // ---------------------------------------------------------------------------

  it("subscription_address_rotations_weekday_check rejects weekday=0", async () => {
    await expect(sql`
      INSERT INTO subscription_address_rotations
        (subscription_id, tenant_id, weekday, address_id)
      VALUES
        (${subscriptionId}, ${TENANT_A}, 0, ${addressId})
    `).rejects.toMatchObject({
      message: expect.stringMatching(/subscription_address_rotations_weekday_check/),
    });
  });

  it("subscription_address_rotations_weekday_check rejects weekday=8", async () => {
    await expect(sql`
      INSERT INTO subscription_address_rotations
        (subscription_id, tenant_id, weekday, address_id)
      VALUES
        (${subscriptionId}, ${TENANT_A}, 8, ${addressId})
    `).rejects.toMatchObject({
      message: expect.stringMatching(/subscription_address_rotations_weekday_check/),
    });
  });

  it("subscription_address_rotations_sub_weekday_idx UNIQUE catches duplicate (subscription_id, weekday)", async () => {
    await sql`
      INSERT INTO subscription_address_rotations
        (subscription_id, tenant_id, weekday, address_id)
      VALUES
        (${subscriptionId}, ${TENANT_A}, 4, ${addressId})
    `;
    await expect(sql`
      INSERT INTO subscription_address_rotations
        (subscription_id, tenant_id, weekday, address_id)
      VALUES
        (${subscriptionId}, ${TENANT_A}, 4, ${addressId})
    `).rejects.toMatchObject({
      message: expect.stringMatching(/subscription_address_rotations_sub_weekday_idx/),
    });
  });

  // ---------------------------------------------------------------------------
  // consignees.crm_state
  // ---------------------------------------------------------------------------

  it("consignees_crm_state_check accepts UPDATE to all six valid states", async () => {
    for (const state of [
      "ACTIVE",
      "ON_HOLD",
      "HIGH_RISK",
      "INACTIVE",
      "CHURNED",
      "SUBSCRIPTION_ENDED",
    ]) {
      await sql`UPDATE consignees SET crm_state = ${state} WHERE id = ${consigneeId}`;
    }
  });

  it("consignees_crm_state_check rejects UPDATE to unknown state", async () => {
    await expect(sql`
      UPDATE consignees SET crm_state = 'INVALID_STATE' WHERE id = ${consigneeId}
    `).rejects.toMatchObject({
      message: expect.stringMatching(/consignees_crm_state_check/),
    });
  });

  // ---------------------------------------------------------------------------
  // webhook_events_dedup_idx UNIQUE
  // ---------------------------------------------------------------------------

  it("webhook_events_dedup_idx UNIQUE catches duplicate (suitefleet_task_id, action, event_timestamp)", async () => {
    const taskId = `d13-check-${RUN_ID}-dedup`;
    const action = "TASK_HAS_BEEN_ORDERED";
    const ts = new Date("2026-05-04T13:00:00Z");
    await sql`
      INSERT INTO webhook_events
        (tenant_id, suitefleet_task_id, action, event_timestamp, raw_payload)
      VALUES
        (${TENANT_A}, ${taskId}, ${action}, ${ts}, ${'{"first":true}'}::jsonb)
    `;
    await expect(sql`
      INSERT INTO webhook_events
        (tenant_id, suitefleet_task_id, action, event_timestamp, raw_payload)
      VALUES
        (${TENANT_A}, ${taskId}, ${action}, ${ts}, ${'{"second":true}'}::jsonb)
    `).rejects.toMatchObject({
      message: expect.stringMatching(/webhook_events_dedup_idx/),
    });
  });

  // ---------------------------------------------------------------------------
  // tasks_internal_status_check (extended in 0019)
  // ---------------------------------------------------------------------------

  it("tasks_internal_status_check (extended) accepts SKIPPED on UPDATE", async () => {
    // Insert a task in the default 'CREATED' state, then UPDATE to SKIPPED.
    const tasks = await sql<{ id: string }[]>`
      INSERT INTO tasks (
        tenant_id, consignee_id, subscription_id,
        created_via, customer_order_number,
        delivery_date, delivery_start_time, delivery_end_time
      ) VALUES (
        ${TENANT_A}, ${consigneeId}, ${subscriptionId},
        'subscription', ${`d13-check-${RUN_ID}-skipped-task`},
        '2026-05-25', '14:00', '16:00'
      ) RETURNING id
    `;
    const taskId = tasks[0].id;

    await sql`UPDATE tasks SET internal_status = 'SKIPPED' WHERE id = ${taskId}`;

    const verify = await sql<{ internal_status: string }[]>`
      SELECT internal_status FROM tasks WHERE id = ${taskId}
    `;
    expect(verify[0].internal_status).toBe("SKIPPED");
  });

  it("tasks_internal_status_check rejects UPDATE to unknown status", async () => {
    const tasks = await sql<{ id: string }[]>`
      INSERT INTO tasks (
        tenant_id, consignee_id, subscription_id,
        created_via, customer_order_number,
        delivery_date, delivery_start_time, delivery_end_time
      ) VALUES (
        ${TENANT_A}, ${consigneeId}, ${subscriptionId},
        'subscription', ${`d13-check-${RUN_ID}-bad-status-task`},
        '2026-05-26', '14:00', '16:00'
      ) RETURNING id
    `;
    const taskId = tasks[0].id;

    await expect(sql`
      UPDATE tasks SET internal_status = 'UNKNOWN_STATUS' WHERE id = ${taskId}
    `).rejects.toMatchObject({
      message: expect.stringMatching(/tasks_internal_status_check/),
    });
  });

  // ---------------------------------------------------------------------------
  // tasks.address_id schema-only test (§5.6)
  // ---------------------------------------------------------------------------

  it("tasks.address_id accepts NULL (column is nullable per §1.3.1)", async () => {
    const rows = await sql<{ id: string; address_id: string | null }[]>`
      INSERT INTO tasks (
        tenant_id, consignee_id, subscription_id,
        created_via, customer_order_number,
        delivery_date, delivery_start_time, delivery_end_time,
        address_id
      ) VALUES (
        ${TENANT_A}, ${consigneeId}, ${subscriptionId},
        'subscription', ${`d13-check-${RUN_ID}-addr-null`},
        '2026-05-27', '14:00', '16:00',
        NULL
      ) RETURNING id, address_id
    `;
    expect(rows.length).toBe(1);
    expect(rows[0].address_id).toBeNull();
  });

  it("tasks.address_id accepts a valid addresses.id (FK ok)", async () => {
    const rows = await sql<{ id: string; address_id: string }[]>`
      INSERT INTO tasks (
        tenant_id, consignee_id, subscription_id,
        created_via, customer_order_number,
        delivery_date, delivery_start_time, delivery_end_time,
        address_id
      ) VALUES (
        ${TENANT_A}, ${consigneeId}, ${subscriptionId},
        'subscription', ${`d13-check-${RUN_ID}-addr-ok`},
        '2026-05-28', '14:00', '16:00',
        ${addressId}
      ) RETURNING id, address_id
    `;
    expect(rows.length).toBe(1);
    expect(rows[0].address_id).toBe(addressId);
  });

  it("tasks.address_id rejects random uuid (FK violation 23503)", async () => {
    const randomAddrId = randomUUID();
    await expect(sql`
      INSERT INTO tasks (
        tenant_id, consignee_id, subscription_id,
        created_via, customer_order_number,
        delivery_date, delivery_start_time, delivery_end_time,
        address_id
      ) VALUES (
        ${TENANT_A}, ${consigneeId}, ${subscriptionId},
        'subscription', ${`d13-check-${RUN_ID}-addr-bad`},
        '2026-05-29', '14:00', '16:00',
        ${randomAddrId}
      )
    `).rejects.toMatchObject({
      // The FK constraint is auto-named tasks_address_id_fkey by Postgres.
      message: expect.stringMatching(/tasks_address_id_fkey/),
    });
  });

  it("DELETE FROM addresses for an in-use address rejects (ON DELETE RESTRICT, 23503)", async () => {
    // Create a fresh address + task that references it, then attempt to
    // delete the address.
    const dedicatedAddr = await sql<{ id: string }[]>`
      INSERT INTO addresses (
        consignee_id, tenant_id, label, is_primary,
        line, district, emirate
      ) VALUES (
        ${consigneeId}, ${TENANT_A}, 'office', false,
        'Restrict Test Line', 'Restrict District', 'Dubai'
      ) RETURNING id
    `;
    const dedicatedAddrId = dedicatedAddr[0].id;

    await sql`
      INSERT INTO tasks (
        tenant_id, consignee_id, subscription_id,
        created_via, customer_order_number,
        delivery_date, delivery_start_time, delivery_end_time,
        address_id
      ) VALUES (
        ${TENANT_A}, ${consigneeId}, ${subscriptionId},
        'subscription', ${`d13-check-${RUN_ID}-restrict-task`},
        '2026-05-30', '14:00', '16:00',
        ${dedicatedAddrId}
      )
    `;

    await expect(sql`
      DELETE FROM addresses WHERE id = ${dedicatedAddrId}
    `).rejects.toMatchObject({
      message: expect.stringMatching(/tasks_address_id_fkey|address_id/),
    });
  });
});
