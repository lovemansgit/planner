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

      // Confirm the session variable is genuinely unset on this
      // connection — `current_setting(name, true)` returns NULL when
      // the variable has never been set. This is the precondition
      // the RLS policy's defensive `NULLIF(..., '')::uuid` form
      // collapses to, fail-closing every row.
      const settingProbe = await canarySql<
        { setting: string | null }[]
      >`SELECT current_setting('app.current_tenant_id', true) AS setting`;
      expect(settingProbe[0].setting).toBeNull();

      // The actual canary: query for our two test tenants. Zero
      // expected — the RLS policy filters every row when the
      // session variable is unset.
      const rows = await canarySql<
        SlugRow[]
      >`SELECT slug FROM tenants WHERE slug LIKE ${SLUG_LIKE}`;
      expect(rows.length).toBe(0);
    });
  });
});
