// tests/integration/rls-tenant-isolation.spec.ts
// =============================================================================
// R-3 — the regression check for R-0 (BYPASSRLS hole closure).
//
// What this test proves:
//   - withTenant scoped to tenant A sees only tenant A's row.
//   - withTenant scoped to tenant B sees only tenant B's row.
//   - withServiceRole sees both (BYPASSRLS preserved for legitimate
//     cross-tenant work — audit_events INSERTs, system actors, etc).
//   - withTenant scoped to a third, unrelated tenant id sees no rows
//     (tenant isolation — A and B are invisible to anyone but
//     themselves).
//   - **The canary**: a raw planner_app connection that has NEVER set
//     `app.current_tenant_id` sees zero rows. This is the regression
//     guard for the most dangerous footgun — someone forgetting to
//     wrap a query in `withTenant` or otherwise reaching the DB
//     without setting the session variable. The RLS policy MUST
//     fail-closed, not fail-open.
//
// Day 3 / C-2 extension — `consignees` block. The C-1 RLS policy on
// `consignees` is structurally identical to the one on `tenants`
// proven above, but a structural similarity is not a regression test.
// The block below mirrors the five tenants scenarios for consignees,
// plus the no-session-var canary applied to consignees, so the
// policy carries the same evidence as the table that authored the
// pattern.
//
// What it would catch:
//   - Pre-R-0 code where db.ts's single pool connected as `postgres`
//     would have FAILED cases 1, 2, 4, AND 5 — every query would
//     see all rows because the connecting role has BYPASSRLS=true.
//   - Any future regression that points withTenant at a BYPASSRLS-
//     enabled role.
//   - An RLS-policy regression where the `NULLIF(..., '')::uuid`
//     defensive form is dropped (case 5 fires on `current_setting('...',
//     true)` returning NULL, which only fail-closes because the policy
//     uses the defensive form per 0001's deviation note).
//   - A copy-paste mistake that omits set_config('app.current_tenant_id').
//
// How it runs:
//   - In CI: against the postgres:17 service container. See ci.yml's
//     `integration` job. Provisioning is `scripts/setup-test-db.sh`.
//   - Locally: same script against any Postgres reachable on
//     SUPABASE_DATABASE_URL / SUPABASE_APP_DATABASE_URL. Doc in the
//     script header.
//
// Determinism:
//   - Random per-run UUIDs/slugs. Two reasons:
//     (a) The audit_events_no_delete RULE + ON DELETE CASCADE FK
//         interaction in 0002_audit.sql blocks the obvious cleanup
//         path; using random ids per run avoids the unique-key
//         conflict on retry. Logged at
//         memory/followup_audit_rule_cascade_conflict.md.
//     (b) Concurrent test runs on a shared local DB don't trample
//         each other.
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { withServiceRole, withTenant } from "../../src/shared/db";

// Drizzle's `tx.execute<T>` constrains T to `Record<string, unknown>`,
// so the type-parameter shape is a type alias with an index signature
// rather than an interface (interfaces don't carry an implicit index
// signature in TypeScript).
type SlugRow = { slug: string } & Record<string, unknown>;

describe("R-3 — RLS tenant isolation under withTenant / withServiceRole", () => {
  const RUN_ID = randomUUID().slice(0, 8);
  const TENANT_A = randomUUID();
  const TENANT_B = randomUUID();
  const SLUG_A = `r3-test-${RUN_ID}-a`;
  const SLUG_B = `r3-test-${RUN_ID}-b`;
  const SLUG_LIKE = `r3-test-${RUN_ID}-%`;

  beforeAll(async () => {
    // Insert the two test tenants via withServiceRole. This is the only
    // way to create tenant rows in this codebase — `withTenant` cannot
    // be the path because the session has no tenant id to set yet, and
    // RLS would deny the insert.
    await withServiceRole("R-3 isolation-test setup", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name) VALUES
          (${TENANT_A}, ${SLUG_A}, 'R-3 Test Tenant A'),
          (${TENANT_B}, ${SLUG_B}, 'R-3 Test Tenant B')
      `);
    });
  });

  it("withTenant(A) sees ONLY tenant A's row (RLS filters out B)", async () => {
    const rows = await withTenant(TENANT_A, async (tx) => {
      return tx.execute<SlugRow>(sqlTag`
        SELECT slug FROM tenants WHERE slug LIKE ${SLUG_LIKE} ORDER BY slug
      `);
    });
    expect(rows.length).toBe(1);
    expect(rows[0].slug).toBe(SLUG_A);
  });

  it("withTenant(B) sees ONLY tenant B's row (RLS filters out A)", async () => {
    const rows = await withTenant(TENANT_B, async (tx) => {
      return tx.execute<SlugRow>(sqlTag`
        SELECT slug FROM tenants WHERE slug LIKE ${SLUG_LIKE} ORDER BY slug
      `);
    });
    expect(rows.length).toBe(1);
    expect(rows[0].slug).toBe(SLUG_B);
  });

  it("withServiceRole sees BOTH tenants (BYPASSRLS preserved for cross-tenant work)", async () => {
    const rows = await withServiceRole("R-3 isolation-test verify", async (tx) => {
      return tx.execute<SlugRow>(sqlTag`
        SELECT slug FROM tenants WHERE slug LIKE ${SLUG_LIKE} ORDER BY slug
      `);
    });
    expect(rows.length).toBe(2);
    expect(rows.map((r) => r.slug)).toEqual([SLUG_A, SLUG_B]);
  });

  it("withTenant scoped to an unrelated tenant id sees neither A nor B (tenant isolation)", async () => {
    // Demonstrates that RLS filters per the session variable, not
    // "anyone authenticated sees everything." Different from the
    // canary case below — here the variable IS set, just to a third
    // tenant id.
    const UNRELATED_TENANT = randomUUID();
    const rows = await withTenant(UNRELATED_TENANT, async (tx) => {
      return tx.execute<SlugRow>(sqlTag`
        SELECT slug FROM tenants WHERE slug LIKE ${SLUG_LIKE}
      `);
    });
    expect(rows.length).toBe(0);
  });

  describe("THE CANARY — fail-closed when app.current_tenant_id is never set", () => {
    // This is the regression that matters most. If anyone forgets to
    // wrap a query in `withTenant`, or reaches the DB through some
    // path that bypasses the wrapper without going through
    // `withServiceRole`, the connecting role MUST see zero rows.
    //
    // Why the test opens its own postgres-js connection rather than
    // using the `db` export from src/shared/db.ts: the module-boundary
    // lint rule (PR #3) restricts raw `db` use outside the carve-out.
    // More importantly, this test is specifically about what happens
    // when set_config is NEVER called — bypassing our wrappers
    // entirely is the most honest way to demonstrate that. The
    // connection here is a `planner_app` (NOBYPASSRLS) session with
    // no `app.current_tenant_id` ever touched.

    let canarySql: ReturnType<typeof postgres>;

    beforeAll(() => {
      const url = process.env.SUPABASE_APP_DATABASE_URL;
      if (!url) {
        throw new Error(
          "SUPABASE_APP_DATABASE_URL must be set for the canary case — see CI workflow / scripts/setup-test-db.sh"
        );
      }
      canarySql = postgres(url, { prepare: false, max: 1 });
    });

    afterAll(async () => {
      await canarySql.end({ timeout: 2 });
    });

    it("a raw planner_app connection with no app.current_tenant_id set sees zero rows", async () => {
      // Sanity check: confirm we're connected as planner_app, not
      // accidentally as postgres. If this assertion ever fails the
      // test is meaningless; surface it loudly.
      const role = await canarySql<{ role: string }[]>`SELECT current_user AS role`;
      expect(role[0].role).toBe("planner_app");

      // Confirm the session variable is in a state the RLS policy
      // treats as "no tenant scope". The policy uses
      // `NULLIF(current_setting('app.current_tenant_id', true), '')::uuid`,
      // so it fail-closes on either NULL or the empty string. Both
      // states are valid "unset" outcomes for this canary:
      //   - On a fresh CI Postgres container: NULL (parameter never
      //     declared on this connection).
      //   - On the Supabase pooler: '' (a prior withServiceRole tx
      //     ran `set_config('app.current_tenant_id', '', true)` on
      //     the physical connection; pgBouncer's connection reuse
      //     leaves the GUC declared at empty string even after the
      //     transaction-local set_config ends — confirmed
      //     2026-04-28 against the live preview DB through
      //     aws-1-ap-south-1.pooler.supabase.com).
      // Either is the precondition the RLS policy collapses to,
      // fail-closing every row. Asserting the union here documents
      // the operational reality and keeps the canary honest about
      // what "unset" actually means in production.
      const settingProbe = await canarySql<
        { setting: string | null }[]
      >`SELECT current_setting('app.current_tenant_id', true) AS setting`;
      const setting = settingProbe[0].setting;
      expect(setting === null || setting === "").toBe(true);

      // The actual canary: query for our two test tenants. Zero
      // expected — the RLS policy filters every row when the
      // session variable is unset.
      const rows = await canarySql<
        SlugRow[]
      >`SELECT slug FROM tenants WHERE slug LIKE ${SLUG_LIKE}`;
      expect(rows.length).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Consignees — Day 3 / C-2 extension
  // ---------------------------------------------------------------------------
  // Mirrors the five tenants scenarios + canary, applied to a
  // consignees row inserted into TENANT_A. Reuses TENANT_A and
  // TENANT_B from the outer describe so this block depends on the
  // outer beforeAll having seeded both tenants.
  describe("consignees — same regression coverage", () => {
    type ConsigneeIdRow = { id: string } & Record<string, unknown>;
    type CountRow = { n: number } & Record<string, unknown>;
    type NameRow = { name: string } & Record<string, unknown>;

    const CONSIGNEE_PHONE = `r3-c-${RUN_ID}-1`;
    const CONSIGNEE_NAME = `R-3 Consignee ${RUN_ID}`;
    const CONSIGNEE_NAME_ATTEMPTED = `Cross-tenant overwrite ${RUN_ID}`;
    let consigneeId: string;

    beforeAll(async () => {
      // Tenant A creates a consignee through `withTenant(A)` — the
      // happy path. The WITH CHECK on the RLS policy passes because
      // the row's tenant_id matches the session variable.
      consigneeId = await withTenant(TENANT_A, async (tx) => {
        const rows = await tx.execute<ConsigneeIdRow>(sqlTag`
          INSERT INTO consignees (
            tenant_id, name, phone, address_line, emirate_or_region, district
          ) VALUES (
            ${TENANT_A}, ${CONSIGNEE_NAME}, ${CONSIGNEE_PHONE}, 'Test Address', 'Dubai', 'Test District'
          )
          RETURNING id
        `);
        return rows[0].id;
      });
    });

    it("withTenant(A) sees the consignee it just inserted (RLS allows same-tenant read)", async () => {
      const rows = await withTenant(TENANT_A, async (tx) => {
        return tx.execute<NameRow>(sqlTag`
          SELECT name FROM consignees WHERE id = ${consigneeId}
        `);
      });
      expect(rows.length).toBe(1);
      expect(rows[0].name).toBe(CONSIGNEE_NAME);
    });

    it("withTenant(B) sees zero consignees from tenant A (RLS filters cross-tenant reads)", async () => {
      const rows = await withTenant(TENANT_B, async (tx) => {
        return tx.execute<NameRow>(sqlTag`
          SELECT name FROM consignees WHERE id = ${consigneeId}
        `);
      });
      expect(rows.length).toBe(0);
    });

    it("withTenant(B) UPDATE against tenant A's consignee affects zero rows (RLS blocks cross-tenant writes)", async () => {
      // RLS for UPDATE is enforced by the USING clause on the FOR ALL
      // policy — rows whose tenant_id doesn't match the session
      // variable are invisible to the UPDATE, so the row count is zero.
      // Postgres reports this through the result's `count` field.
      await withTenant(TENANT_B, async (tx) => {
        await tx.execute(sqlTag`
          UPDATE consignees SET name = ${CONSIGNEE_NAME_ATTEMPTED}
          WHERE id = ${consigneeId}
        `);
      });

      // Re-read as tenant A — the name MUST still be the original.
      // This asserts no row was actually updated, regardless of how
      // postgres.js reports row counts on the cross-tenant call.
      const after = await withTenant(TENANT_A, async (tx) => {
        return tx.execute<NameRow>(sqlTag`
          SELECT name FROM consignees WHERE id = ${consigneeId}
        `);
      });
      expect(after.length).toBe(1);
      expect(after[0].name).toBe(CONSIGNEE_NAME);
    });

    it("withTenant(B) DELETE against tenant A's consignee removes nothing (RLS blocks cross-tenant deletes)", async () => {
      await withTenant(TENANT_B, async (tx) => {
        await tx.execute(sqlTag`
          DELETE FROM consignees WHERE id = ${consigneeId}
        `);
      });

      // Tenant A still sees the row.
      const after = await withTenant(TENANT_A, async (tx) => {
        return tx.execute<CountRow>(sqlTag`
          SELECT count(*)::int AS n FROM consignees WHERE id = ${consigneeId}
        `);
      });
      expect(after[0].n).toBe(1);
    });

    it("withTenant scoped to an unrelated tenant id sees zero consignees (full tenant isolation)", async () => {
      const UNRELATED_TENANT = randomUUID();
      const rows = await withTenant(UNRELATED_TENANT, async (tx) => {
        return tx.execute<NameRow>(sqlTag`
          SELECT name FROM consignees WHERE id = ${consigneeId}
        `);
      });
      expect(rows.length).toBe(0);
    });

    it("CANARY — a raw planner_app connection with no app.current_tenant_id sees zero consignees", async () => {
      // Same regression guard as the tenants canary above, applied to
      // consignees. Opens a fresh planner_app connection that never
      // calls set_config. RLS must fail-closed (zero rows), not
      // fail-open.
      const url = process.env.SUPABASE_APP_DATABASE_URL;
      if (!url) {
        throw new Error("SUPABASE_APP_DATABASE_URL must be set for the consignees canary case");
      }
      const canary = postgres(url, { prepare: false, max: 1 });
      try {
        const role = await canary<{ role: string }[]>`SELECT current_user AS role`;
        expect(role[0].role).toBe("planner_app");

        // Same precondition union as the tenants canary above —
        // accept NULL or '' because the policy's NULLIF treats both
        // as "no tenant scope" and the Supabase pooler leaves the
        // variable as ''. See the tenants canary for the full
        // explanation.
        const settingProbe = await canary<
          { setting: string | null }[]
        >`SELECT current_setting('app.current_tenant_id', true) AS setting`;
        const setting = settingProbe[0].setting;
        expect(setting === null || setting === "").toBe(true);

        const rows = await canary<NameRow[]>`SELECT name FROM consignees WHERE id = ${consigneeId}`;
        expect(rows.length).toBe(0);
      } finally {
        await canary.end({ timeout: 2 });
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Tasks — Day 5 / T-2 extension
  // ---------------------------------------------------------------------------
  // Mirrors the five tenants scenarios + canary, applied to a tasks
  // row inserted into TENANT_A. Self-contained: creates its own
  // consignee dependency (tasks.consignee_id is NOT NULL with ON
  // DELETE RESTRICT) so this block does not depend on the consignees
  // block above.
  describe("tasks — same regression coverage", () => {
    type IdRow = { id: string } & Record<string, unknown>;
    type CountRow = { n: number } & Record<string, unknown>;
    type OrderRow = { customer_order_number: string } & Record<string, unknown>;

    const TASK_ORDER = `T2-RLS-${RUN_ID}`;
    const TASK_ORDER_ATTEMPTED = `T2-RLS-ATTEMPTED-${RUN_ID}`;
    const TASK_CONSIGNEE_PHONE = `t2-task-${RUN_ID}-1`;
    let taskConsigneeId: string;
    let taskId: string;

    beforeAll(async () => {
      // Tenant A creates a consignee + task through withTenant(A).
      // Both inserts pass the RLS WITH CHECK because the row's
      // tenant_id matches the session variable. The task insert also
      // satisfies the consignees FK because the session can SELECT
      // the consignee it just created.
      taskConsigneeId = await withTenant(TENANT_A, async (tx) => {
        const rows = await tx.execute<IdRow>(sqlTag`
          INSERT INTO consignees (
            tenant_id, name, phone, address_line, emirate_or_region, district
          ) VALUES (
            ${TENANT_A}, 'T-2 Task Consignee', ${TASK_CONSIGNEE_PHONE}, 'Test Address', 'Dubai', 'Test District'
          )
          RETURNING id
        `);
        return rows[0].id;
      });

      taskId = await withTenant(TENANT_A, async (tx) => {
        const rows = await tx.execute<IdRow>(sqlTag`
          INSERT INTO tasks (
            tenant_id, consignee_id, customer_order_number,
            delivery_date, delivery_start_time, delivery_end_time,
            created_via
          ) VALUES (
            ${TENANT_A}, ${taskConsigneeId}, ${TASK_ORDER},
            '2026-05-01', '14:00', '16:00',
            'manual_admin'
          )
          RETURNING id
        `);
        return rows[0].id;
      });
    });

    it("withTenant(A) sees the task it just inserted (RLS allows same-tenant read)", async () => {
      const rows = await withTenant(TENANT_A, async (tx) => {
        return tx.execute<OrderRow>(sqlTag`
          SELECT customer_order_number FROM tasks WHERE id = ${taskId}
        `);
      });
      expect(rows.length).toBe(1);
      expect(rows[0].customer_order_number).toBe(TASK_ORDER);
    });

    it("withTenant(B) sees zero tasks from tenant A (RLS filters cross-tenant reads)", async () => {
      const rows = await withTenant(TENANT_B, async (tx) => {
        return tx.execute<OrderRow>(sqlTag`
          SELECT customer_order_number FROM tasks WHERE id = ${taskId}
        `);
      });
      expect(rows.length).toBe(0);
    });

    it("withTenant(B) UPDATE against tenant A's task affects zero rows (RLS blocks cross-tenant writes)", async () => {
      await withTenant(TENANT_B, async (tx) => {
        await tx.execute(sqlTag`
          UPDATE tasks SET customer_order_number = ${TASK_ORDER_ATTEMPTED}
          WHERE id = ${taskId}
        `);
      });

      const after = await withTenant(TENANT_A, async (tx) => {
        return tx.execute<OrderRow>(sqlTag`
          SELECT customer_order_number FROM tasks WHERE id = ${taskId}
        `);
      });
      expect(after.length).toBe(1);
      expect(after[0].customer_order_number).toBe(TASK_ORDER);
    });

    it("withTenant(B) DELETE against tenant A's task removes nothing (RLS blocks cross-tenant deletes)", async () => {
      await withTenant(TENANT_B, async (tx) => {
        await tx.execute(sqlTag`
          DELETE FROM tasks WHERE id = ${taskId}
        `);
      });

      const after = await withTenant(TENANT_A, async (tx) => {
        return tx.execute<CountRow>(sqlTag`
          SELECT count(*)::int AS n FROM tasks WHERE id = ${taskId}
        `);
      });
      expect(after[0].n).toBe(1);
    });

    it("withTenant scoped to an unrelated tenant id sees zero tasks (full tenant isolation)", async () => {
      const UNRELATED_TENANT = randomUUID();
      const rows = await withTenant(UNRELATED_TENANT, async (tx) => {
        return tx.execute<OrderRow>(sqlTag`
          SELECT customer_order_number FROM tasks WHERE id = ${taskId}
        `);
      });
      expect(rows.length).toBe(0);
    });

    it("CANARY — a raw planner_app connection with no app.current_tenant_id sees zero tasks", async () => {
      const url = process.env.SUPABASE_APP_DATABASE_URL;
      if (!url) {
        throw new Error("SUPABASE_APP_DATABASE_URL must be set for the tasks canary case");
      }
      const canary = postgres(url, { prepare: false, max: 1 });
      try {
        const role = await canary<{ role: string }[]>`SELECT current_user AS role`;
        expect(role[0].role).toBe("planner_app");

        const settingProbe = await canary<
          { setting: string | null }[]
        >`SELECT current_setting('app.current_tenant_id', true) AS setting`;
        const setting = settingProbe[0].setting;
        expect(setting === null || setting === "").toBe(true);

        const rows = await canary<
          OrderRow[]
        >`SELECT customer_order_number FROM tasks WHERE id = ${taskId}`;
        expect(rows.length).toBe(0);
      } finally {
        await canary.end({ timeout: 2 });
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Task packages — Day 5 / T-2 extension
  // ---------------------------------------------------------------------------
  // Mirrors the five tenants scenarios + canary, applied to a
  // task_packages row inserted into TENANT_A. Self-contained: creates
  // its own consignee + task dependencies through withTenant(A) so
  // this block does not depend on the tasks block above.
  //
  // Note on the schema-layer trigger interaction. The
  // task_packages_assert_tenant_match trigger fires BEFORE INSERT OR
  // UPDATE and asserts task_packages.tenant_id = parent's tenant_id.
  // The seed below inserts task_packages with tenant_id = TENANT_A
  // and task_id = task_a, so the trigger passes. Cross-tenant
  // attempts in the body of these tests are blocked by RLS (USING
  // clause filters target rows out before the UPDATE/DELETE engages),
  // not by the trigger — the trigger only runs against rows that
  // survive the policy. The trigger's BYPASSRLS coverage is in
  // tests/integration/task-packages-tenant-match.spec.ts.
  describe("task_packages — same regression coverage", () => {
    type IdRow = { id: string } & Record<string, unknown>;
    type CountRow = { n: number } & Record<string, unknown>;
    type StatusRow = { package_status: string } & Record<string, unknown>;

    const PKG_CONSIGNEE_PHONE = `t2-pkg-${RUN_ID}-1`;
    let packageId: string;

    beforeAll(async () => {
      const consigneeId = await withTenant(TENANT_A, async (tx) => {
        const rows = await tx.execute<IdRow>(sqlTag`
          INSERT INTO consignees (
            tenant_id, name, phone, address_line, emirate_or_region, district
          ) VALUES (
            ${TENANT_A}, 'T-2 Package Consignee', ${PKG_CONSIGNEE_PHONE}, 'Test Address', 'Dubai', 'Test District'
          )
          RETURNING id
        `);
        return rows[0].id;
      });

      const pkgTaskId = await withTenant(TENANT_A, async (tx) => {
        const rows = await tx.execute<IdRow>(sqlTag`
          INSERT INTO tasks (
            tenant_id, consignee_id, customer_order_number,
            delivery_date, delivery_start_time, delivery_end_time,
            created_via
          ) VALUES (
            ${TENANT_A}, ${consigneeId}, ${`T2-RLS-PKG-${RUN_ID}`},
            '2026-05-01', '14:00', '16:00',
            'manual_admin'
          )
          RETURNING id
        `);
        return rows[0].id;
      });

      packageId = await withTenant(TENANT_A, async (tx) => {
        const rows = await tx.execute<IdRow>(sqlTag`
          INSERT INTO task_packages (
            task_id, tenant_id, position
          ) VALUES (
            ${pkgTaskId}, ${TENANT_A}, 0
          )
          RETURNING id
        `);
        return rows[0].id;
      });
    });

    it("withTenant(A) sees the task_package it just inserted (RLS allows same-tenant read)", async () => {
      const rows = await withTenant(TENANT_A, async (tx) => {
        return tx.execute<StatusRow>(sqlTag`
          SELECT package_status FROM task_packages WHERE id = ${packageId}
        `);
      });
      expect(rows.length).toBe(1);
      expect(rows[0].package_status).toBe("ORDERED");
    });

    it("withTenant(B) sees zero task_packages from tenant A (RLS filters cross-tenant reads)", async () => {
      const rows = await withTenant(TENANT_B, async (tx) => {
        return tx.execute<StatusRow>(sqlTag`
          SELECT package_status FROM task_packages WHERE id = ${packageId}
        `);
      });
      expect(rows.length).toBe(0);
    });

    it("withTenant(B) UPDATE against tenant A's task_package affects zero rows (RLS blocks before the trigger fires)", async () => {
      // RLS filters the UPDATE's target rows by the USING predicate
      // before the trigger has a chance to fire. The result is that
      // the UPDATE touches zero rows; no trigger exception. This is
      // distinct from the BYPASSRLS path covered in
      // task-packages-tenant-match.spec.ts.
      await withTenant(TENANT_B, async (tx) => {
        await tx.execute(sqlTag`
          UPDATE task_packages SET package_status = 'DELIVERED' WHERE id = ${packageId}
        `);
      });

      const after = await withTenant(TENANT_A, async (tx) => {
        return tx.execute<StatusRow>(sqlTag`
          SELECT package_status FROM task_packages WHERE id = ${packageId}
        `);
      });
      expect(after.length).toBe(1);
      expect(after[0].package_status).toBe("ORDERED");
    });

    it("withTenant(B) DELETE against tenant A's task_package removes nothing (RLS blocks cross-tenant deletes)", async () => {
      await withTenant(TENANT_B, async (tx) => {
        await tx.execute(sqlTag`
          DELETE FROM task_packages WHERE id = ${packageId}
        `);
      });

      const after = await withTenant(TENANT_A, async (tx) => {
        return tx.execute<CountRow>(sqlTag`
          SELECT count(*)::int AS n FROM task_packages WHERE id = ${packageId}
        `);
      });
      expect(after[0].n).toBe(1);
    });

    it("withTenant scoped to an unrelated tenant id sees zero task_packages (full tenant isolation)", async () => {
      const UNRELATED_TENANT = randomUUID();
      const rows = await withTenant(UNRELATED_TENANT, async (tx) => {
        return tx.execute<StatusRow>(sqlTag`
          SELECT package_status FROM task_packages WHERE id = ${packageId}
        `);
      });
      expect(rows.length).toBe(0);
    });

    it("CANARY — a raw planner_app connection with no app.current_tenant_id sees zero task_packages", async () => {
      const url = process.env.SUPABASE_APP_DATABASE_URL;
      if (!url) {
        throw new Error("SUPABASE_APP_DATABASE_URL must be set for the task_packages canary case");
      }
      const canary = postgres(url, { prepare: false, max: 1 });
      try {
        const role = await canary<{ role: string }[]>`SELECT current_user AS role`;
        expect(role[0].role).toBe("planner_app");

        const settingProbe = await canary<
          { setting: string | null }[]
        >`SELECT current_setting('app.current_tenant_id', true) AS setting`;
        const setting = settingProbe[0].setting;
        expect(setting === null || setting === "").toBe(true);

        const rows = await canary<
          StatusRow[]
        >`SELECT package_status FROM task_packages WHERE id = ${packageId}`;
        expect(rows.length).toBe(0);
      } finally {
        await canary.end({ timeout: 2 });
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Failed pushes — Day 5 / T-7 extension
  // ---------------------------------------------------------------------------
  // Mirrors the five tenants scenarios + canary, applied to a
  // failed_pushes row inserted into TENANT_A. Self-contained: creates
  // its own consignee + task dependencies through withServiceRole
  // because the failed-pushes module's repository runs system-only
  // (no withTenant path), and using withServiceRole here matches the
  // production write path.
  //
  // Note on RLS-vs-trigger interaction (same as task_packages
  // block): cross-tenant attempts are filtered by RLS USING before
  // the failed_pushes_assert_tenant_match trigger has a chance to
  // fire (the trigger only sees rows that survive the policy). The
  // trigger's BYPASSRLS coverage lives in
  // tests/integration/failed-pushes-tenant-match.spec.ts.
  describe("failed_pushes — same regression coverage", () => {
    type IdRow = { id: string } & Record<string, unknown>;
    type CountRow = { n: number } & Record<string, unknown>;
    type ReasonRow = { failure_reason: string } & Record<string, unknown>;

    const FP_CONSIGNEE_PHONE = `t7-fp-${RUN_ID}-1`;
    let failedPushId: string;

    beforeAll(async () => {
      // Seed via withServiceRole so we don't have to thread the
      // tenant session for the multi-step setup. The repository's
      // production caller is also withServiceRole.
      await withServiceRole("T-7 RLS-block setup", async (tx) => {
        const consigneeRows = await tx.execute<IdRow>(sqlTag`
          INSERT INTO consignees (
            tenant_id, name, phone, address_line, emirate_or_region, district
          ) VALUES (
            ${TENANT_A}, 'T-7 FP Consignee', ${FP_CONSIGNEE_PHONE}, 'Test Address', 'Dubai', 'Test District'
          )
          RETURNING id
        `);
        const consigneeId = consigneeRows[0].id;

        const taskRows = await tx.execute<IdRow>(sqlTag`
          INSERT INTO tasks (
            tenant_id, consignee_id, customer_order_number,
            delivery_date, delivery_start_time, delivery_end_time,
            created_via
          ) VALUES (
            ${TENANT_A}, ${consigneeId}, ${`T7-RLS-FP-${RUN_ID}`},
            '2026-05-01', '14:00', '16:00',
            'manual_admin'
          )
          RETURNING id
        `);
        const fpTaskId = taskRows[0].id;

        const fpRows = await tx.execute<IdRow>(sqlTag`
          INSERT INTO failed_pushes (
            tenant_id, task_id, task_payload, failure_reason
          ) VALUES (
            ${TENANT_A}, ${fpTaskId},
            '{"customerOrderNumber":"T7-RLS"}'::jsonb, 'network'
          )
          RETURNING id
        `);
        failedPushId = fpRows[0].id;
      });
    });

    it("withTenant(A) sees the failed_push it just inserted (RLS allows same-tenant read)", async () => {
      const rows = await withTenant(TENANT_A, async (tx) => {
        return tx.execute<ReasonRow>(sqlTag`
          SELECT failure_reason FROM failed_pushes WHERE id = ${failedPushId}
        `);
      });
      expect(rows.length).toBe(1);
      expect(rows[0].failure_reason).toBe("network");
    });

    it("withTenant(B) sees zero failed_pushes from tenant A (RLS filters cross-tenant reads)", async () => {
      const rows = await withTenant(TENANT_B, async (tx) => {
        return tx.execute<ReasonRow>(sqlTag`
          SELECT failure_reason FROM failed_pushes WHERE id = ${failedPushId}
        `);
      });
      expect(rows.length).toBe(0);
    });

    it("withTenant(B) UPDATE against tenant A's failed_push affects zero rows (RLS blocks before the trigger fires)", async () => {
      await withTenant(TENANT_B, async (tx) => {
        await tx.execute(sqlTag`
          UPDATE failed_pushes SET failure_reason = 'timeout' WHERE id = ${failedPushId}
        `);
      });

      const after = await withTenant(TENANT_A, async (tx) => {
        return tx.execute<ReasonRow>(sqlTag`
          SELECT failure_reason FROM failed_pushes WHERE id = ${failedPushId}
        `);
      });
      expect(after.length).toBe(1);
      expect(after[0].failure_reason).toBe("network");
    });

    it("withTenant(B) DELETE against tenant A's failed_push removes nothing (RLS blocks cross-tenant deletes)", async () => {
      await withTenant(TENANT_B, async (tx) => {
        await tx.execute(sqlTag`
          DELETE FROM failed_pushes WHERE id = ${failedPushId}
        `);
      });

      const after = await withTenant(TENANT_A, async (tx) => {
        return tx.execute<CountRow>(sqlTag`
          SELECT count(*)::int AS n FROM failed_pushes WHERE id = ${failedPushId}
        `);
      });
      expect(after[0].n).toBe(1);
    });

    it("withTenant scoped to an unrelated tenant id sees zero failed_pushes (full tenant isolation)", async () => {
      const UNRELATED_TENANT = randomUUID();
      const rows = await withTenant(UNRELATED_TENANT, async (tx) => {
        return tx.execute<ReasonRow>(sqlTag`
          SELECT failure_reason FROM failed_pushes WHERE id = ${failedPushId}
        `);
      });
      expect(rows.length).toBe(0);
    });

    it("CANARY — a raw planner_app connection with no app.current_tenant_id sees zero failed_pushes", async () => {
      const url = process.env.SUPABASE_APP_DATABASE_URL;
      if (!url) {
        throw new Error("SUPABASE_APP_DATABASE_URL must be set for the failed_pushes canary case");
      }
      const canary = postgres(url, { prepare: false, max: 1 });
      try {
        const role = await canary<{ role: string }[]>`SELECT current_user AS role`;
        expect(role[0].role).toBe("planner_app");

        const settingProbe = await canary<
          { setting: string | null }[]
        >`SELECT current_setting('app.current_tenant_id', true) AS setting`;
        const setting = settingProbe[0].setting;
        expect(setting === null || setting === "").toBe(true);

        const rows = await canary<
          ReasonRow[]
        >`SELECT failure_reason FROM failed_pushes WHERE id = ${failedPushId}`;
        expect(rows.length).toBe(0);
      } finally {
        await canary.end({ timeout: 2 });
      }
    });
  });

  describe("subscriptions — same regression coverage (S-1)", () => {
    type IdRow = { id: string } & Record<string, unknown>;
    type CountRow = { n: number } & Record<string, unknown>;
    type StatusRow = { status: string } & Record<string, unknown>;

    const SUB_CONSIGNEE_PHONE = `s1-sub-${RUN_ID}-1`;
    let subscriptionId: string;

    beforeAll(async () => {
      // Seed via withServiceRole. Same posture as the tasks /
      // failed_pushes setups above — multi-step setup is cleaner under
      // service-role, and the subscription module's system-actor caller
      // (cron task generation, Day 7+) will also run withServiceRole.
      await withServiceRole("S-1 RLS-block setup", async (tx) => {
        const consigneeRows = await tx.execute<IdRow>(sqlTag`
          INSERT INTO consignees (
            tenant_id, name, phone, address_line, emirate_or_region, district
          ) VALUES (
            ${TENANT_A}, 'S-1 Sub Consignee', ${SUB_CONSIGNEE_PHONE},
            'Test Address', 'Dubai', 'Test District'
          )
          RETURNING id
        `);
        const consigneeId = consigneeRows[0].id;

        const subRows = await tx.execute<IdRow>(sqlTag`
          INSERT INTO subscriptions (
            tenant_id, consignee_id, status,
            start_date, end_date,
            days_of_week,
            delivery_window_start, delivery_window_end
          ) VALUES (
            ${TENANT_A}, ${consigneeId}, 'active',
            '2026-05-01', '2026-08-31',
            ARRAY[1, 3, 5]::integer[],
            '14:00', '16:00'
          )
          RETURNING id
        `);
        subscriptionId = subRows[0].id;
      });
    });

    it("withTenant(A) sees the subscription it just inserted (RLS allows same-tenant read)", async () => {
      const rows = await withTenant(TENANT_A, async (tx) => {
        return tx.execute<StatusRow>(sqlTag`
          SELECT status FROM subscriptions WHERE id = ${subscriptionId}
        `);
      });
      expect(rows.length).toBe(1);
      expect(rows[0].status).toBe("active");
    });

    it("withTenant(B) sees zero subscriptions from tenant A (RLS filters cross-tenant reads)", async () => {
      const rows = await withTenant(TENANT_B, async (tx) => {
        return tx.execute<StatusRow>(sqlTag`
          SELECT status FROM subscriptions WHERE id = ${subscriptionId}
        `);
      });
      expect(rows.length).toBe(0);
    });

    it("withTenant(B) UPDATE against tenant A's subscription affects zero rows (RLS blocks cross-tenant writes)", async () => {
      await withTenant(TENANT_B, async (tx) => {
        await tx.execute(sqlTag`
          UPDATE subscriptions SET status = 'paused' WHERE id = ${subscriptionId}
        `);
      });

      const after = await withTenant(TENANT_A, async (tx) => {
        return tx.execute<StatusRow>(sqlTag`
          SELECT status FROM subscriptions WHERE id = ${subscriptionId}
        `);
      });
      expect(after.length).toBe(1);
      expect(after[0].status).toBe("active");
    });

    it("withTenant(B) DELETE against tenant A's subscription removes nothing (RLS blocks cross-tenant deletes)", async () => {
      await withTenant(TENANT_B, async (tx) => {
        await tx.execute(sqlTag`
          DELETE FROM subscriptions WHERE id = ${subscriptionId}
        `);
      });

      const after = await withTenant(TENANT_A, async (tx) => {
        return tx.execute<CountRow>(sqlTag`
          SELECT count(*)::int AS n FROM subscriptions WHERE id = ${subscriptionId}
        `);
      });
      expect(after[0].n).toBe(1);
    });

    it("withTenant scoped to an unrelated tenant id sees zero subscriptions (full tenant isolation)", async () => {
      const UNRELATED_TENANT = randomUUID();
      const rows = await withTenant(UNRELATED_TENANT, async (tx) => {
        return tx.execute<StatusRow>(sqlTag`
          SELECT status FROM subscriptions WHERE id = ${subscriptionId}
        `);
      });
      expect(rows.length).toBe(0);
    });

    it("CANARY — a raw planner_app connection with no app.current_tenant_id sees zero subscriptions", async () => {
      const url = process.env.SUPABASE_APP_DATABASE_URL;
      if (!url) {
        throw new Error("SUPABASE_APP_DATABASE_URL must be set for the subscriptions canary case");
      }
      const canary = postgres(url, { prepare: false, max: 1 });
      try {
        const role = await canary<{ role: string }[]>`SELECT current_user AS role`;
        expect(role[0].role).toBe("planner_app");

        const settingProbe = await canary<
          { setting: string | null }[]
        >`SELECT current_setting('app.current_tenant_id', true) AS setting`;
        const setting = settingProbe[0].setting;
        expect(setting === null || setting === "").toBe(true);

        const rows = await canary<
          StatusRow[]
        >`SELECT status FROM subscriptions WHERE id = ${subscriptionId}`;
        expect(rows.length).toBe(0);
      } finally {
        await canary.end({ timeout: 2 });
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Asset tracking cache — Day 6 / B-1 extension
  // ---------------------------------------------------------------------------
  // Mirrors the five tenants scenarios + canary, applied to an
  // asset_tracking_cache row inserted into TENANT_A. Self-contained:
  // creates its own consignee + task dependencies through
  // withTenant(A) so this block does not depend on the tasks /
  // task_packages blocks above.
  //
  // Note on RLS-vs-trigger interaction (same as task_packages /
  // failed_pushes blocks): cross-tenant attempts are filtered by RLS
  // USING before the asset_tracking_cache_assert_tenant_match trigger
  // has a chance to fire. The trigger's BYPASSRLS coverage lives in
  // tests/integration/asset-tracking-tenant-match.spec.ts.
  describe("asset_tracking_cache — same regression coverage", () => {
    type IdRow = { id: string } & Record<string, unknown>;
    type CountRow = { n: number } & Record<string, unknown>;
    type StateRow = { state: string } & Record<string, unknown>;

    const AT_CONSIGNEE_PHONE = `b1-at-${RUN_ID}-1`;
    let cacheRowId: string;

    beforeAll(async () => {
      const consigneeId = await withTenant(TENANT_A, async (tx) => {
        const rows = await tx.execute<IdRow>(sqlTag`
          INSERT INTO consignees (
            tenant_id, name, phone, address_line, emirate_or_region, district
          ) VALUES (
            ${TENANT_A}, 'B-1 AT Consignee', ${AT_CONSIGNEE_PHONE}, 'Test Address', 'Dubai', 'Test District'
          )
          RETURNING id
        `);
        return rows[0].id;
      });

      const atTaskId = await withTenant(TENANT_A, async (tx) => {
        const rows = await tx.execute<IdRow>(sqlTag`
          INSERT INTO tasks (
            tenant_id, consignee_id, customer_order_number,
            delivery_date, delivery_start_time, delivery_end_time,
            created_via
          ) VALUES (
            ${TENANT_A}, ${consigneeId}, ${`B1-RLS-AT-${RUN_ID}`},
            '2026-05-01', '14:00', '16:00',
            'manual_admin'
          )
          RETURNING id
        `);
        return rows[0].id;
      });

      cacheRowId = await withTenant(TENANT_A, async (tx) => {
        const rows = await tx.execute<IdRow>(sqlTag`
          INSERT INTO asset_tracking_cache (
            task_id, task_id_external, external_record_id,
            tracking_id, type, state, tenant_id
          ) VALUES (
            ${atTaskId}, 88001, 60001,
            ${`B1-RLS-AT-${RUN_ID}-1`},
            'BAGS', 'COLLECTED', ${TENANT_A}
          )
          RETURNING id
        `);
        return rows[0].id;
      });
    });

    it("withTenant(A) sees the asset_tracking_cache row it just inserted (RLS allows same-tenant read)", async () => {
      const rows = await withTenant(TENANT_A, async (tx) => {
        return tx.execute<StateRow>(sqlTag`
          SELECT state FROM asset_tracking_cache WHERE id = ${cacheRowId}
        `);
      });
      expect(rows.length).toBe(1);
      expect(rows[0].state).toBe("COLLECTED");
    });

    it("withTenant(B) sees zero asset_tracking_cache rows from tenant A (RLS filters cross-tenant reads)", async () => {
      const rows = await withTenant(TENANT_B, async (tx) => {
        return tx.execute<StateRow>(sqlTag`
          SELECT state FROM asset_tracking_cache WHERE id = ${cacheRowId}
        `);
      });
      expect(rows.length).toBe(0);
    });

    it("withTenant(B) UPDATE against tenant A's cache row affects zero rows (RLS blocks before the trigger fires)", async () => {
      await withTenant(TENANT_B, async (tx) => {
        await tx.execute(sqlTag`
          UPDATE asset_tracking_cache SET state = 'RECEIVED' WHERE id = ${cacheRowId}
        `);
      });

      const after = await withTenant(TENANT_A, async (tx) => {
        return tx.execute<StateRow>(sqlTag`
          SELECT state FROM asset_tracking_cache WHERE id = ${cacheRowId}
        `);
      });
      expect(after.length).toBe(1);
      expect(after[0].state).toBe("COLLECTED");
    });

    it("withTenant(B) DELETE against tenant A's cache row removes nothing (RLS blocks cross-tenant deletes)", async () => {
      await withTenant(TENANT_B, async (tx) => {
        await tx.execute(sqlTag`
          DELETE FROM asset_tracking_cache WHERE id = ${cacheRowId}
        `);
      });

      const after = await withTenant(TENANT_A, async (tx) => {
        return tx.execute<CountRow>(sqlTag`
          SELECT count(*)::int AS n FROM asset_tracking_cache WHERE id = ${cacheRowId}
        `);
      });
      expect(after[0].n).toBe(1);
    });

    it("withTenant scoped to an unrelated tenant id sees zero asset_tracking_cache rows (full tenant isolation)", async () => {
      const UNRELATED_TENANT = randomUUID();
      const rows = await withTenant(UNRELATED_TENANT, async (tx) => {
        return tx.execute<StateRow>(sqlTag`
          SELECT state FROM asset_tracking_cache WHERE id = ${cacheRowId}
        `);
      });
      expect(rows.length).toBe(0);
    });

    it("CANARY — a raw planner_app connection with no app.current_tenant_id sees zero asset_tracking_cache rows", async () => {
      const url = process.env.SUPABASE_APP_DATABASE_URL;
      if (!url) {
        throw new Error(
          "SUPABASE_APP_DATABASE_URL must be set for the asset_tracking_cache canary case",
        );
      }
      const canary = postgres(url, { prepare: false, max: 1 });
      try {
        const role = await canary<{ role: string }[]>`SELECT current_user AS role`;
        expect(role[0].role).toBe("planner_app");

        const settingProbe = await canary<
          { setting: string | null }[]
        >`SELECT current_setting('app.current_tenant_id', true) AS setting`;
        const setting = settingProbe[0].setting;
        expect(setting === null || setting === "").toBe(true);

        const rows = await canary<
          StateRow[]
        >`SELECT state FROM asset_tracking_cache WHERE id = ${cacheRowId}`;
        expect(rows.length).toBe(0);
      } finally {
        await canary.end({ timeout: 2 });
      }
    });
  });

  // ---------------------------------------------------------------------------
  // task_generation_runs — Day 7 / C-2 extension
  // ---------------------------------------------------------------------------
  // Mirrors the five tenants scenarios + canary, applied to a
  // task_generation_runs row inserted into TENANT_A. Self-contained:
  // seeds via withServiceRole because task_generation_runs writes
  // happen exclusively from the cron, which runs under
  // withServiceRole. Reuses TENANT_A and TENANT_B from the outer
  // describe.
  //
  // Unlike task_packages / failed_pushes / asset_tracking_cache, this
  // table has NO denormalised tenant_id paired with a child FK, so
  // there is no *_assert_tenant_match trigger to coexist with. The
  // RLS policy alone is the schema-layer defence; the trigger
  // category does not apply (header in 0012).
  describe("task_generation_runs — same regression coverage", () => {
    type IdRow = { id: string } & Record<string, unknown>;
    type CountRow = { n: number } & Record<string, unknown>;
    type StatusRow = { status: string } & Record<string, unknown>;

    const RUN_WINDOW_START = "2026-05-02T12:00:00Z";
    const RUN_WINDOW_END = "2026-05-02T13:00:00Z";
    let runRowId: string;

    beforeAll(async () => {
      // Seed via withServiceRole. Mirrors the cron's actual write path
      // (the cron is a cross-tenant system actor and uses
      // withServiceRole to insert run rows for whichever tenant it's
      // walking).
      await withServiceRole("C-2 RLS-block setup", async (tx) => {
        // target_date NOT NULL added by migration 0020; computed as
        // window_start + 1 day in Asia/Dubai per the migration's backfill
        // form (16:00 Dubai for the canonical 12:00 UTC tick → next day).
        const rows = await tx.execute<IdRow>(sqlTag`
          INSERT INTO task_generation_runs (
            tenant_id, window_start, window_end, target_date,
            status, cap_threshold
          ) VALUES (
            ${TENANT_A}, ${RUN_WINDOW_START}, ${RUN_WINDOW_END},
            ((${RUN_WINDOW_START}::timestamptz AT TIME ZONE 'Asia/Dubai')::date + 1),
            'completed', 7000
          )
          RETURNING id
        `);
        runRowId = rows[0].id;
      });
    });

    it("withTenant(A) sees the run row it just inserted (RLS allows same-tenant read)", async () => {
      const rows = await withTenant(TENANT_A, async (tx) => {
        return tx.execute<StatusRow>(sqlTag`
          SELECT status FROM task_generation_runs WHERE id = ${runRowId}
        `);
      });
      expect(rows.length).toBe(1);
      expect(rows[0].status).toBe("completed");
    });

    it("withTenant(B) sees zero run rows from tenant A (RLS filters cross-tenant reads)", async () => {
      const rows = await withTenant(TENANT_B, async (tx) => {
        return tx.execute<StatusRow>(sqlTag`
          SELECT status FROM task_generation_runs WHERE id = ${runRowId}
        `);
      });
      expect(rows.length).toBe(0);
    });

    it("withTenant(B) UPDATE against tenant A's run row affects zero rows (RLS blocks cross-tenant writes)", async () => {
      await withTenant(TENANT_B, async (tx) => {
        await tx.execute(sqlTag`
          UPDATE task_generation_runs SET status = 'failed', error_text = 'cross-tenant attempt'
          WHERE id = ${runRowId}
        `);
      });

      const after = await withTenant(TENANT_A, async (tx) => {
        return tx.execute<StatusRow>(sqlTag`
          SELECT status FROM task_generation_runs WHERE id = ${runRowId}
        `);
      });
      expect(after.length).toBe(1);
      expect(after[0].status).toBe("completed");
    });

    it("withTenant(B) DELETE against tenant A's run row removes nothing (RLS blocks cross-tenant deletes)", async () => {
      await withTenant(TENANT_B, async (tx) => {
        await tx.execute(sqlTag`
          DELETE FROM task_generation_runs WHERE id = ${runRowId}
        `);
      });

      const after = await withTenant(TENANT_A, async (tx) => {
        return tx.execute<CountRow>(sqlTag`
          SELECT count(*)::int AS n FROM task_generation_runs WHERE id = ${runRowId}
        `);
      });
      expect(after[0].n).toBe(1);
    });

    it("withTenant scoped to an unrelated tenant id sees zero run rows (full tenant isolation)", async () => {
      const UNRELATED_TENANT = randomUUID();
      const rows = await withTenant(UNRELATED_TENANT, async (tx) => {
        return tx.execute<StatusRow>(sqlTag`
          SELECT status FROM task_generation_runs WHERE id = ${runRowId}
        `);
      });
      expect(rows.length).toBe(0);
    });

    it("CANARY — a raw planner_app connection with no app.current_tenant_id sees zero task_generation_runs rows", async () => {
      const url = process.env.SUPABASE_APP_DATABASE_URL;
      if (!url) {
        throw new Error(
          "SUPABASE_APP_DATABASE_URL must be set for the task_generation_runs canary case",
        );
      }
      const canary = postgres(url, { prepare: false, max: 1 });
      try {
        const role = await canary<{ role: string }[]>`SELECT current_user AS role`;
        expect(role[0].role).toBe("planner_app");

        const settingProbe = await canary<
          { setting: string | null }[]
        >`SELECT current_setting('app.current_tenant_id', true) AS setting`;
        const setting = settingProbe[0].setting;
        expect(setting === null || setting === "").toBe(true);

        const rows = await canary<
          StatusRow[]
        >`SELECT status FROM task_generation_runs WHERE id = ${runRowId}`;
        expect(rows.length).toBe(0);
      } finally {
        await canary.end({ timeout: 2 });
      }
    });
  });

  // ---------------------------------------------------------------------------
  // tenant_suitefleet_webhook_credentials — Day 8 / D8-2 extension
  // ---------------------------------------------------------------------------
  // Mirrors the five tenants scenarios + canary, applied to a
  // tenant_suitefleet_webhook_credentials row inserted into TENANT_A.
  // Self-contained: seeds via withServiceRole because credential rows
  // are created by an admin flow that runs under service-role (Tenant
  // Admin → admin route → server-side insert). Reuses TENANT_A and
  // TENANT_B from the outer describe.
  //
  // Same posture as task_generation_runs: this table has tenant_id as
  // the PRIMARY KEY (not a denormalised column alongside a separate
  // FK), so there is no *_assert_tenant_match trigger to coexist with.
  // The RLS policy alone is the schema-layer defence; the trigger
  // category does not apply (header in 0013).
  describe("tenant_suitefleet_webhook_credentials — same regression coverage", () => {
    type CountRow = { n: number } & Record<string, unknown>;
    type ClientIdRow = { client_id: string } & Record<string, unknown>;

    const CLIENT_ID = `d8-creds-${RUN_ID}`;
    const CLIENT_ID_ATTEMPTED = `d8-creds-${RUN_ID}-cross-tenant`;
    // Constant-format placeholder — bcrypt hashes look similar in
    // shape. This block doesn't exercise hash semantics; just that
    // RLS scoping holds for whatever value the column carries.
    const SECRET_HASH = `$2b$10$d8creds${RUN_ID}placeholderhashforintegrationtest`;

    beforeAll(async () => {
      await withServiceRole("D8-2 RLS-block setup", async (tx) => {
        await tx.execute(sqlTag`
          INSERT INTO tenant_suitefleet_webhook_credentials (
            tenant_id, client_id, client_secret_hash
          ) VALUES (
            ${TENANT_A}, ${CLIENT_ID}, ${SECRET_HASH}
          )
        `);
      });
    });

    it("withTenant(A) sees the credential row it just inserted (RLS allows same-tenant read)", async () => {
      const rows = await withTenant(TENANT_A, async (tx) => {
        return tx.execute<ClientIdRow>(sqlTag`
          SELECT client_id FROM tenant_suitefleet_webhook_credentials WHERE tenant_id = ${TENANT_A}
        `);
      });
      expect(rows.length).toBe(1);
      expect(rows[0].client_id).toBe(CLIENT_ID);
    });

    it("withTenant(B) sees zero credential rows from tenant A (RLS filters cross-tenant reads)", async () => {
      const rows = await withTenant(TENANT_B, async (tx) => {
        return tx.execute<ClientIdRow>(sqlTag`
          SELECT client_id FROM tenant_suitefleet_webhook_credentials WHERE tenant_id = ${TENANT_A}
        `);
      });
      expect(rows.length).toBe(0);
    });

    it("withTenant(B) UPDATE against tenant A's credential row affects zero rows (RLS blocks cross-tenant writes)", async () => {
      await withTenant(TENANT_B, async (tx) => {
        await tx.execute(sqlTag`
          UPDATE tenant_suitefleet_webhook_credentials SET client_id = ${CLIENT_ID_ATTEMPTED}
          WHERE tenant_id = ${TENANT_A}
        `);
      });

      const after = await withTenant(TENANT_A, async (tx) => {
        return tx.execute<ClientIdRow>(sqlTag`
          SELECT client_id FROM tenant_suitefleet_webhook_credentials WHERE tenant_id = ${TENANT_A}
        `);
      });
      expect(after.length).toBe(1);
      expect(after[0].client_id).toBe(CLIENT_ID);
    });

    it("withTenant(B) DELETE against tenant A's credential row removes nothing (RLS blocks cross-tenant deletes)", async () => {
      await withTenant(TENANT_B, async (tx) => {
        await tx.execute(sqlTag`
          DELETE FROM tenant_suitefleet_webhook_credentials WHERE tenant_id = ${TENANT_A}
        `);
      });

      const after = await withTenant(TENANT_A, async (tx) => {
        return tx.execute<CountRow>(sqlTag`
          SELECT count(*)::int AS n FROM tenant_suitefleet_webhook_credentials WHERE tenant_id = ${TENANT_A}
        `);
      });
      expect(after[0].n).toBe(1);
    });

    it("withTenant scoped to an unrelated tenant id sees zero credential rows (full tenant isolation)", async () => {
      const UNRELATED_TENANT = randomUUID();
      const rows = await withTenant(UNRELATED_TENANT, async (tx) => {
        return tx.execute<ClientIdRow>(sqlTag`
          SELECT client_id FROM tenant_suitefleet_webhook_credentials WHERE tenant_id = ${TENANT_A}
        `);
      });
      expect(rows.length).toBe(0);
    });

    it("CANARY — a raw planner_app connection with no app.current_tenant_id sees zero credential rows", async () => {
      const url = process.env.SUPABASE_APP_DATABASE_URL;
      if (!url) {
        throw new Error(
          "SUPABASE_APP_DATABASE_URL must be set for the tenant_suitefleet_webhook_credentials canary case",
        );
      }
      const canary = postgres(url, { prepare: false, max: 1 });
      try {
        const role = await canary<{ role: string }[]>`SELECT current_user AS role`;
        expect(role[0].role).toBe("planner_app");

        const settingProbe = await canary<
          { setting: string | null }[]
        >`SELECT current_setting('app.current_tenant_id', true) AS setting`;
        const setting = settingProbe[0].setting;
        expect(setting === null || setting === "").toBe(true);

        const rows = await canary<
          ClientIdRow[]
        >`SELECT client_id FROM tenant_suitefleet_webhook_credentials WHERE tenant_id = ${TENANT_A}`;
        expect(rows.length).toBe(0);
      } finally {
        await canary.end({ timeout: 2 });
      }
    });
  });
});
