// tests/integration/identity-create-user-flow.spec.ts
// =============================================================================
// Day-24 — real-Postgres integration coverage for the new identity write
// paths landing alongside the /admin/users surface:
//   - createUserInDb (mirror INSERT)
//   - createRoleAssignment (role_assignments INSERT, role/tenant
//     compatibility, cross-tenant write via withServiceRole)
//   - listAllUsers (cross-tenant SELECT, archive filter, search-by-email)
//
// Day-23 §F discipline: any new SQL path needs a real-Postgres pin so
// column-name drift catches at the regression-grade integration tier,
// not at the unit-tier-with-mocked-tx layer. The supabase.auth.admin
// SDK is the third-party boundary and is NOT exercised here; the
// service-entry `createUser` path is unit-tested with the admin client
// mocked at src/modules/identity/tests/service-create.spec.ts.
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createRoleAssignment,
  createUserInDb,
  listAllUsers,
} from "../../src/modules/identity/service";
import { withServiceRole, withTenant } from "../../src/shared/db";
import type { RequestContext } from "../../src/shared/tenant-context";
import type { Permission, Uuid } from "../../src/shared/types";

const RUN_ID = randomUUID().slice(0, 8);
const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const TENANT_ARCHIVED = randomUUID();
const SLUG_A = `iduf-${RUN_ID}-a`;
const SLUG_B = `iduf-${RUN_ID}-b`;
const SLUG_ARCHIVED = `iduf-${RUN_ID}-arch`;
const TRANSCORP_ID_FOR_TEST = randomUUID();
const TRANSCORP_SLUG_FOR_TEST = `transcorp-${RUN_ID}`;

// Auth user UUIDs (no real auth.users rows; createUserInDb only writes
// the mirror row + role assignments — the FK reference to auth.users
// is enforced by the migration but the integration DB seeds them
// alongside the mirror rows here via the same `users` insert path).
//
// We bypass the auth.users FK by using `ON DELETE CASCADE`-compatible
// UUIDs that don't reference auth.users (the FK is deferrable in dev;
// in prod every users row tracks an auth.users row). Wrap in a
// SAVEPOINT pattern: insert into auth.users first.
const AUTH_USER_A = randomUUID();
const AUTH_USER_B = randomUUID();
const AUTH_USER_TRANSCORP = randomUUID();

const ACTOR_USER_ID = randomUUID();

function transcorpStaffCtx(): RequestContext {
  const perms: Permission[] = [
    "user:create",
    "role_assignment:create",
    "merchant:read_all",
  ];
  return {
    actor: {
      kind: "user",
      userId: ACTOR_USER_ID,
      tenantId: TENANT_A,
      permissions: new Set(perms),
    },
    tenantId: TENANT_A,
    requestId: `test-${RUN_ID}`,
    path: "/admin/users",
  };
}

describe("identity create-user flow — integration", () => {
  beforeAll(async () => {
    await withServiceRole("identity-flow integration setup", async (tx) => {
      // Seed auth.users rows for the FK on public.users.id. Direct
      // SQL into auth.users is RLS-bypassed under withServiceRole and
      // gives the integration test stable IDs without round-tripping
      // through Supabase Auth's hosted service.
      await tx.execute(sqlTag`
        INSERT INTO auth.users (id, email)
        VALUES
          (${AUTH_USER_A}, ${`a-${RUN_ID}@example.com`}),
          (${AUTH_USER_B}, ${`b-${RUN_ID}@example.com`}),
          (${AUTH_USER_TRANSCORP}, ${`sysadmin-${RUN_ID}@example.com`})
        ON CONFLICT (id) DO NOTHING
      `);

      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, status) VALUES
          (${TENANT_A}, ${SLUG_A}, 'IDUF Test A', 'active'),
          (${TENANT_B}, ${SLUG_B}, 'IDUF Test B', 'active'),
          (${TENANT_ARCHIVED}, ${SLUG_ARCHIVED}, 'IDUF Test Archived', 'archived'),
          (${TRANSCORP_ID_FOR_TEST}, ${TRANSCORP_SLUG_FOR_TEST}, 'IDUF Transcorp', 'active')
      `);
    });
  });

  afterAll(async () => {
    // audit_events_no_delete RULE blocks DELETE FROM tenants when matching
    // audit_events exist (see memory/followup_audit_rule_cascade_conflict.md).
    // Best-effort teardown; swallow the rule-induced failure. auth.users
    // cleanup runs first (cascades to public.users + role_assignments);
    // tenant DELETE may fail per audit RULE — caught + ignored.
    try {
      await withServiceRole("identity-flow integration teardown", async (tx) => {
        await tx.execute(sqlTag`
          DELETE FROM auth.users WHERE id IN (
            ${AUTH_USER_A}, ${AUTH_USER_B}, ${AUTH_USER_TRANSCORP}
          )
        `);
        await tx.execute(sqlTag`
          DELETE FROM tenants WHERE id IN (
            ${TENANT_A}, ${TENANT_B}, ${TENANT_ARCHIVED}, ${TRANSCORP_ID_FOR_TEST}
          )
        `);
      });
    } catch {
      /* audit RULE; ignore */
    }
  });

  // -------------------------------------------------------------------------
  // createUserInDb
  // -------------------------------------------------------------------------

  describe("createUserInDb", () => {
    it("inserts a mirror row scoped to the target tenant", async () => {
      await withTenant(TENANT_A, async (tx) => {
        await createUserInDb(tx, {
          authUserId: AUTH_USER_A,
          tenantId: TENANT_A as Uuid,
          email: `a-${RUN_ID}@example.com`,
          displayName: "User A",
        });
      });

      await withServiceRole("verify createUserInDb", async (tx) => {
        type Row = { tenant_id: string; email: string; display_name: string | null };
        const rows = await tx.execute<Row>(sqlTag`
          SELECT tenant_id, email, display_name FROM users WHERE id = ${AUTH_USER_A}
        `);
        expect(rows.length).toBe(1);
        expect(rows[0].tenant_id).toBe(TENANT_A);
        expect(rows[0].display_name).toBe("User A");
      });
    });

    it("upserts (ON CONFLICT) and clears disabled_at on re-issue", async () => {
      // First issue (already done in previous test); now reissue.
      await withServiceRole("simulate disabled_at", async (tx) => {
        await tx.execute(sqlTag`
          UPDATE users SET disabled_at = now() WHERE id = ${AUTH_USER_A}
        `);
      });

      await withTenant(TENANT_A, async (tx) => {
        await createUserInDb(tx, {
          authUserId: AUTH_USER_A,
          tenantId: TENANT_A as Uuid,
          email: `a-updated-${RUN_ID}@example.com`,
          displayName: null, // null shouldn't wipe existing display_name
        });
      });

      await withServiceRole("verify upsert", async (tx) => {
        type Row = { email: string; display_name: string | null; disabled_at: Date | null };
        const rows = await tx.execute<Row>(sqlTag`
          SELECT email, display_name, disabled_at FROM users WHERE id = ${AUTH_USER_A}
        `);
        expect(rows[0].email).toBe(`a-updated-${RUN_ID}@example.com`);
        expect(rows[0].display_name).toBe("User A"); // preserved via COALESCE
        expect(rows[0].disabled_at).toBeNull();
      });
    });
  });

  // -------------------------------------------------------------------------
  // createRoleAssignment
  // -------------------------------------------------------------------------

  describe("createRoleAssignment", () => {
    it("inserts a role_assignment for a merchant tenant", async () => {
      const ctx = transcorpStaffCtx();
      // Mirror row required before role assignment FK is valid.
      await withTenant(TENANT_B, async (tx) => {
        await createUserInDb(tx, {
          authUserId: AUTH_USER_B,
          tenantId: TENANT_B as Uuid,
          email: `b-${RUN_ID}@example.com`,
          displayName: "User B",
        });
      });

      const { assignmentId } = await createRoleAssignment(ctx, {
        userId: AUTH_USER_B as Uuid,
        roleSlug: "tenant-admin",
        tenantId: TENANT_B as Uuid,
      });
      expect(assignmentId).toMatch(/^[0-9a-f-]{36}$/i);

      await withServiceRole("verify role_assignment", async (tx) => {
        type Row = { role_slug: string; tenant_id: string };
        const rows = await tx.execute<Row>(sqlTag`
          SELECT r.slug AS role_slug, ra.tenant_id::text AS tenant_id
          FROM role_assignments ra
          JOIN roles r ON r.id = ra.role_id
          WHERE ra.id = ${assignmentId}
        `);
        expect(rows[0].role_slug).toBe("tenant-admin");
        expect(rows[0].tenant_id).toBe(TENANT_B);
      });
    });

    it("rejects transcorp-sysadmin role into a merchant tenant", async () => {
      const ctx = transcorpStaffCtx();
      await expect(
        createRoleAssignment(ctx, {
          userId: AUTH_USER_B as Uuid,
          roleSlug: "transcorp-sysadmin",
          tenantId: TENANT_B as Uuid,
        }),
      ).rejects.toThrow(/not assignable/i);
    });

    it("is idempotent on (user_id, role_id, tenant_id) — re-issue returns the same id (Day-24 schema-drift hotfix regression pin)", async () => {
      // Regression pin for the Day-24 PR #259 hotfix. The original
      // ON CONFLICT clause wrote `SET created_at =
      // role_assignments.created_at` but the table has `assigned_at`
      // (not `created_at` — see migration 0001_identity.sql:76).
      // Postgres raised 42703 errorMissingColumn and every form
      // submit 500'd. Re-issuing the same assignment exercises the
      // ON CONFLICT path end-to-end; if column-name drift re-
      // surfaces, this assertion fails with the same Postgres error
      // at integration tier before merge.
      const ctx = transcorpStaffCtx();
      const first = await createRoleAssignment(ctx, {
        userId: AUTH_USER_B as Uuid,
        roleSlug: "tenant-admin",
        tenantId: TENANT_B as Uuid,
      });
      const second = await createRoleAssignment(ctx, {
        userId: AUTH_USER_B as Uuid,
        roleSlug: "tenant-admin",
        tenantId: TENANT_B as Uuid,
      });
      expect(second.assignmentId).toBe(first.assignmentId);
    });
  });

  // -------------------------------------------------------------------------
  // listAllUsers
  // -------------------------------------------------------------------------

  describe("listAllUsers", () => {
    it("returns users joined with their tenant + role slugs", async () => {
      const ctx = transcorpStaffCtx();
      // Search by RUN_ID-scoped email substring so we only see this
      // test's seeded rows.
      const rows = await listAllUsers(ctx, { searchTerm: `-${RUN_ID}@` });
      const aRow = rows.find((r) => r.userId === AUTH_USER_A);
      const bRow = rows.find((r) => r.userId === AUTH_USER_B);
      expect(aRow).toBeDefined();
      expect(bRow).toBeDefined();
      expect(aRow?.tenantId).toBe(TENANT_A);
      expect(bRow?.tenantId).toBe(TENANT_B);
      expect(bRow?.roleSlugs).toContain("tenant-admin");
    });

    it("hides users belonging to archived tenants", async () => {
      // Seed a user against the archived tenant.
      const archivedUserId = randomUUID();
      const archivedEmail = `arch-${RUN_ID}@example.com`;
      await withServiceRole("seed archived-tenant user", async (tx) => {
        await tx.execute(sqlTag`
          INSERT INTO auth.users (id, email) VALUES (${archivedUserId}, ${archivedEmail})
          ON CONFLICT DO NOTHING
        `);
        await tx.execute(sqlTag`
          INSERT INTO users (id, tenant_id, email)
          VALUES (${archivedUserId}, ${TENANT_ARCHIVED}, ${archivedEmail})
        `);
      });

      try {
        const ctx = transcorpStaffCtx();
        const rows = await listAllUsers(ctx, { searchTerm: `arch-${RUN_ID}` });
        expect(rows.find((r) => r.userId === archivedUserId)).toBeUndefined();
      } finally {
        await withServiceRole("teardown archived-tenant user", async (tx) => {
          await tx.execute(sqlTag`DELETE FROM auth.users WHERE id = ${archivedUserId}`);
        });
      }
    });
  });
});
