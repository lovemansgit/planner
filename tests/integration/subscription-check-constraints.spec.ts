// tests/integration/subscription-check-constraints.spec.ts
// =============================================================================
// S-1 — schema-layer integrity tests for the subscriptions table CHECK
// constraints from 0009_subscription.sql.
//
// What this test proves:
//   Each named CHECK constraint on the subscriptions table fires when
//   its invariant is violated and lets valid rows through. The four
//   CHECKs under test:
//     - subscriptions_end_date_after_start
//     - subscriptions_days_of_week_non_empty
//     - subscriptions_days_of_week_iso_domain
//     - subscriptions_delivery_window_strict
//   Plus the inline `status` CHECK (value-domain on status).
//
// Why this lives in its own file:
//   rls-tenant-isolation.spec.ts is the regression suite for the RLS
//   policy form. CHECK-constraint behaviour is a different mechanism —
//   row-level integrity that runs regardless of policy state. Same
//   separation as task-packages-tenant-match.spec.ts and
//   failed-pushes-tenant-match.spec.ts.
//
// Why this connects directly via `postgres-js` rather than withServiceRole:
//   Same reasoning as the canary block in rls-tenant-isolation.spec.ts —
//   the point is to demonstrate that the constraint fires at the schema
//   layer regardless of the caller. CHECK rejections come from the engine,
//   not the application wrapper.
//
// Notable invariant tested empirically (pinned in the migration header):
//   `cardinality(days_of_week) BETWEEN 1 AND 7` correctly rejects empty
//   arrays, whereas the brief's literal `array_length(days_of_week, 1)
//   BETWEEN 1 AND 7` would silently allow them (array_length on empty
//   arrays returns NULL, which CHECK treats as PASS). The
//   "rejects empty days_of_week" case below is the regression guard
//   for that gotcha.
//
// Determinism:
//   Random per-run UUIDs.
// =============================================================================

import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("S-1 — subscriptions CHECK constraints fire at the schema layer", () => {
  const RUN_ID = randomUUID().slice(0, 8);
  const TENANT_A = randomUUID();
  const SLUG_A = `s1-check-${RUN_ID}-a`;
  const CONSIGNEE_PHONE = `s1-check-${RUN_ID}-1`;

  let sql: ReturnType<typeof postgres>;
  let consigneeId: string;

  beforeAll(async () => {
    const url = process.env.SUPABASE_DATABASE_URL;
    if (!url) {
      throw new Error(
        "SUPABASE_DATABASE_URL must be set for the S-1 CHECK constraint test — direct connection bypasses the application wrapper to verify the schema layer enforces invariants on its own"
      );
    }
    sql = postgres(url, { prepare: false, max: 1 });

    // Sanity-check this really is the BYPASSRLS connection. If it
    // isn't, the rejection could come from RLS rather than the CHECK.
    const role = await sql<{ role: string; bypassrls: boolean }[]>`
      SELECT current_user AS role, rolbypassrls AS bypassrls
      FROM pg_roles
      WHERE rolname = current_user
    `;
    expect(role[0].bypassrls).toBe(true);

    // Set up tenant + consignee as parents.
    await sql`
      INSERT INTO tenants (id, slug, name) VALUES
        (${TENANT_A}, ${SLUG_A}, 'S-1 Check Test Tenant')
    `;

    const consignees = await sql<{ id: string }[]>`
      INSERT INTO consignees (
        tenant_id, name, phone, address_line, emirate_or_region, district
      ) VALUES (
        ${TENANT_A}, 'S-1 Check Consignee', ${CONSIGNEE_PHONE},
        'Test Address', 'Dubai', 'Test District'
      )
      RETURNING id
    `;
    consigneeId = consignees[0].id;
  });

  afterAll(async () => {
    if (sql) {
      try {
        await sql`DELETE FROM subscriptions WHERE tenant_id = ${TENANT_A}`;
        await sql`DELETE FROM consignees    WHERE tenant_id = ${TENANT_A}`;
        await sql`DELETE FROM tenants       WHERE id = ${TENANT_A}`;
      } catch {
        // Cleanup failure is not test failure.
      }
      await sql.end({ timeout: 2 });
    }
  });

  it("accepts a fully valid subscription row (sanity baseline)", async () => {
    const rows = await sql<{ id: string }[]>`
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
    expect(rows.length).toBe(1);
  });

  it("rejects end_date before start_date (subscriptions_end_date_after_start)", async () => {
    await expect(sql`
      INSERT INTO subscriptions (
        tenant_id, consignee_id,
        start_date, end_date,
        days_of_week,
        delivery_window_start, delivery_window_end
      ) VALUES (
        ${TENANT_A}, ${consigneeId},
        '2026-05-01', '2026-04-01',
        ${[1, 3, 5]},
        '14:00', '16:00'
      )
    `).rejects.toMatchObject({
      message: expect.stringMatching(/subscriptions_end_date_after_start/),
    });
  });

  it("accepts NULL end_date as open-ended (boundary case)", async () => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO subscriptions (
        tenant_id, consignee_id,
        start_date, end_date,
        days_of_week,
        delivery_window_start, delivery_window_end
      ) VALUES (
        ${TENANT_A}, ${consigneeId},
        '2026-05-01', NULL,
        ${[2, 4]},
        '09:00', '11:00'
      )
      RETURNING id
    `;
    expect(rows.length).toBe(1);
  });

  it("accepts end_date equal to start_date as a single-day subscription (boundary case)", async () => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO subscriptions (
        tenant_id, consignee_id,
        start_date, end_date,
        days_of_week,
        delivery_window_start, delivery_window_end
      ) VALUES (
        ${TENANT_A}, ${consigneeId},
        '2026-05-15', '2026-05-15',
        ${[6]},
        '08:00', '10:00'
      )
      RETURNING id
    `;
    expect(rows.length).toBe(1);
  });

  it("rejects empty days_of_week (subscriptions_days_of_week_non_empty — cardinality 0 rejected)", async () => {
    // Regression guard: pins that we use cardinality(), not
    // array_length(...) BETWEEN 1 AND 7 — array_length on empty arrays
    // returns NULL, which CHECK treats as PASS.
    await expect(sql`
      INSERT INTO subscriptions (
        tenant_id, consignee_id,
        start_date, days_of_week,
        delivery_window_start, delivery_window_end
      ) VALUES (
        ${TENANT_A}, ${consigneeId},
        '2026-05-01', ${[] as number[]},
        '14:00', '16:00'
      )
    `).rejects.toMatchObject({
      message: expect.stringMatching(/subscriptions_days_of_week_non_empty/),
    });
  });

  it("rejects days_of_week with element value 0 (subscriptions_days_of_week_iso_domain — outside 1-7)", async () => {
    await expect(sql`
      INSERT INTO subscriptions (
        tenant_id, consignee_id,
        start_date, days_of_week,
        delivery_window_start, delivery_window_end
      ) VALUES (
        ${TENANT_A}, ${consigneeId},
        '2026-05-01', ${[0, 1, 2]},
        '14:00', '16:00'
      )
    `).rejects.toMatchObject({
      message: expect.stringMatching(/subscriptions_days_of_week_iso_domain/),
    });
  });

  it("rejects days_of_week with element value 8 (subscriptions_days_of_week_iso_domain — outside 1-7)", async () => {
    await expect(sql`
      INSERT INTO subscriptions (
        tenant_id, consignee_id,
        start_date, days_of_week,
        delivery_window_start, delivery_window_end
      ) VALUES (
        ${TENANT_A}, ${consigneeId},
        '2026-05-01', ${[1, 2, 8]},
        '14:00', '16:00'
      )
    `).rejects.toMatchObject({
      message: expect.stringMatching(/subscriptions_days_of_week_iso_domain/),
    });
  });

  it("accepts the full ISO range [1,2,3,4,5,6,7] (boundary case)", async () => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO subscriptions (
        tenant_id, consignee_id,
        start_date, days_of_week,
        delivery_window_start, delivery_window_end
      ) VALUES (
        ${TENANT_A}, ${consigneeId},
        '2026-05-01', ${[1, 2, 3, 4, 5, 6, 7]},
        '06:00', '22:00'
      )
      RETURNING id
    `;
    expect(rows.length).toBe(1);
  });

  it("rejects delivery_window_start equal to delivery_window_end (subscriptions_delivery_window_strict — strict less-than)", async () => {
    await expect(sql`
      INSERT INTO subscriptions (
        tenant_id, consignee_id,
        start_date, days_of_week,
        delivery_window_start, delivery_window_end
      ) VALUES (
        ${TENANT_A}, ${consigneeId},
        '2026-05-01', ${[1]},
        '14:00', '14:00'
      )
    `).rejects.toMatchObject({
      message: expect.stringMatching(/subscriptions_delivery_window_strict/),
    });
  });

  it("rejects delivery_window_start after delivery_window_end (subscriptions_delivery_window_strict)", async () => {
    await expect(sql`
      INSERT INTO subscriptions (
        tenant_id, consignee_id,
        start_date, days_of_week,
        delivery_window_start, delivery_window_end
      ) VALUES (
        ${TENANT_A}, ${consigneeId},
        '2026-05-01', ${[1]},
        '16:00', '14:00'
      )
    `).rejects.toMatchObject({
      message: expect.stringMatching(/subscriptions_delivery_window_strict/),
    });
  });

  it("rejects status outside the closed enum (status CHECK — value-domain)", async () => {
    await expect(sql`
      INSERT INTO subscriptions (
        tenant_id, consignee_id, status,
        start_date, days_of_week,
        delivery_window_start, delivery_window_end
      ) VALUES (
        ${TENANT_A}, ${consigneeId}, 'invalid-status',
        '2026-05-01', ${[1]},
        '14:00', '16:00'
      )
    `).rejects.toMatchObject({
      message: expect.stringMatching(/subscriptions_status_check/),
    });
  });

  it("accepts each valid status value individually (status CHECK — boundary cases)", async () => {
    for (const status of ["active", "paused", "ended"]) {
      const rows = await sql<{ id: string; status: string }[]>`
        INSERT INTO subscriptions (
          tenant_id, consignee_id, status,
          start_date, days_of_week,
          delivery_window_start, delivery_window_end
        ) VALUES (
          ${TENANT_A}, ${consigneeId}, ${status},
          '2026-05-01', ${[1]},
          '14:00', '16:00'
        )
        RETURNING id, status
      `;
      expect(rows.length).toBe(1);
      expect(rows[0].status).toBe(status);
    }
  });

  it("defaults status to 'active' when omitted (default-value behaviour)", async () => {
    const rows = await sql<{ status: string }[]>`
      INSERT INTO subscriptions (
        tenant_id, consignee_id,
        start_date, days_of_week,
        delivery_window_start, delivery_window_end
      ) VALUES (
        ${TENANT_A}, ${consigneeId},
        '2026-05-01', ${[1]},
        '14:00', '16:00'
      )
      RETURNING status
    `;
    expect(rows[0].status).toBe("active");
  });
});
