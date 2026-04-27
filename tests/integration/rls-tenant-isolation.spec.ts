// tests/integration/rls-tenant-isolation.spec.ts
// =============================================================================
// R-3 — the regression check for R-0 (BYPASSRLS hole closure).
//
// What this test proves:
//   - withTenant scoped to tenant A sees only tenant A's row.
//   - withTenant scoped to tenant B sees only tenant B's row.
//   - withServiceRole sees both (BYPASSRLS preserved for legitimate
//     cross-tenant work — audit_events INSERTs, system actors, etc).
//
// What it would catch:
//   - Pre-R-0 code where db.ts's single pool connected as `postgres`
//     would have FAILED tests 1 and 2 — every withTenant call would
//     see all rows because the connecting role has BYPASSRLS=true.
//   - Any future regression that points withTenant at a BYPASSRLS-
//     enabled role.
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
import { beforeAll, describe, expect, it } from "vitest";

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

  it("withTenant with an unrelated tenant id sees zero rows (fail-closed)", async () => {
    // Use a fresh random UUID that isn't either of A or B. RLS should
    // filter every row out — proves the policy is filtering on the
    // session variable, not waving everything through.
    const UNRELATED_TENANT = randomUUID();
    const rows = await withTenant(UNRELATED_TENANT, async (tx) => {
      return tx.execute<SlugRow>(sqlTag`
        SELECT slug FROM tenants WHERE slug LIKE ${SLUG_LIKE}
      `);
    });
    expect(rows.length).toBe(0);
  });
});
