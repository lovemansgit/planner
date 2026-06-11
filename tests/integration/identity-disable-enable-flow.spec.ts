// tests/integration/identity-disable-enable-flow.spec.ts
// =============================================================================
// Day-24 — real-Postgres integration coverage for the disable/enable
// mirror UPDATE paths landing alongside /admin/users disable + enable
// surfaces:
//   - disableUserInDb  (UPDATE users SET disabled_at = now())
//   - enableUserInDb   (UPDATE users SET disabled_at = NULL)
//   - listAllUsers     re-verified to surface disabled_at in the row
//
// Day-23 §F discipline: any new SQL write path needs a real-Postgres
// pin so column-name drift catches at integration tier, not at the
// unit-tier-with-mocked-tx layer. The supabase.auth.admin SDK is the
// third-party boundary and is NOT exercised here; the service-entry
// `disableUser` / `enableUser` paths are unit-tested with the admin
// client mocked at src/modules/identity/tests/service-disable-enable.spec.ts.
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createUserInDb,
  disableUserInDb,
  enableUserInDb,
  listAllUsers,
} from "../../src/modules/identity/service";
import { withServiceRole, withTenant } from "../../src/shared/db";
import type { RequestContext } from "../../src/shared/tenant-context";
import type { Permission, Uuid } from "../../src/shared/types";

const RUN_ID = randomUUID().slice(0, 8);
const TENANT = randomUUID();
const SLUG = `idde-${RUN_ID}`;
const AUTH_USER_A = randomUUID();
const AUTH_USER_B = randomUUID();

const ACTOR_USER_ID = randomUUID();

function transcorpStaffCtx(): RequestContext {
  const perms: Permission[] = ["user:update", "merchant:read_all"];
  return {
    actor: {
      kind: "user",
      userId: ACTOR_USER_ID,
      tenantId: TENANT,
      permissions: new Set(perms),
    },
    tenantId: TENANT,
    requestId: `test-${RUN_ID}`,
    path: "/admin/users",
  };
}

describe("identity disable/enable flow — integration", () => {
  beforeAll(async () => {
    await withServiceRole("identity-disable-enable integration setup", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO auth.users (id, email)
        VALUES
          (${AUTH_USER_A}, ${`a-${RUN_ID}@example.com`}),
          (${AUTH_USER_B}, ${`b-${RUN_ID}@example.com`})
        ON CONFLICT (id) DO NOTHING
      `);
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, status) VALUES
          (${TENANT}, ${SLUG}, 'IDDE Test', 'active')
      `);
    });

    // Seed two mirror rows via the same createUserInDb path the new
    // /admin/users surface uses — proves disable/enable composes
    // cleanly with create.
    await withTenant(TENANT, async (tx) => {
      await createUserInDb(tx, {
        authUserId: AUTH_USER_A,
        tenantId: TENANT as Uuid,
        email: `a-${RUN_ID}@example.com`,
        displayName: "User A",
      });
      await createUserInDb(tx, {
        authUserId: AUTH_USER_B,
        tenantId: TENANT as Uuid,
        email: `b-${RUN_ID}@example.com`,
        displayName: "User B",
      });
    });
  });

  afterAll(async () => {
    // audit_events_no_delete RULE blocks DELETE FROM tenants when matching
    // audit_events exist (see memory/followup_audit_rule_cascade_conflict.md).
    // Best-effort teardown; swallow the rule-induced failure.
    try {
      await withServiceRole("identity-disable-enable integration teardown", async (tx) => {
        await tx.execute(sqlTag`
          DELETE FROM auth.users WHERE id IN (${AUTH_USER_A}, ${AUTH_USER_B})
        `);
        await tx.execute(sqlTag`DELETE FROM tenants WHERE id = ${TENANT}`);
      });
    } catch {
      /* audit RULE; ignore */
    }
  });

  // -------------------------------------------------------------------------
  // disableUserInDb
  // -------------------------------------------------------------------------

  describe("disableUserInDb", () => {
    it("sets disabled_at to a non-null timestamp", async () => {
      await withTenant(TENANT, async (tx) => {
        await disableUserInDb(tx, { authUserId: AUTH_USER_A });
      });

      await withServiceRole("verify disabled_at set", async (tx) => {
        type Row = { disabled_at: Date | string | null };
        const rows = await tx.execute<Row>(sqlTag`
          SELECT disabled_at FROM users WHERE id = ${AUTH_USER_A}
        `);
        expect(rows[0].disabled_at).not.toBeNull();
      });
    });

    it("is idempotent — re-disabling refreshes the timestamp but does not error", async () => {
      // Capture the first timestamp.
      const firstTs = await withServiceRole("capture first disabled_at", async (tx) => {
        type Row = { disabled_at: string };
        const rows = await tx.execute<Row>(sqlTag`
          SELECT disabled_at::text AS disabled_at FROM users WHERE id = ${AUTH_USER_A}
        `);
        return rows[0].disabled_at;
      });

      // Sleep 50ms then re-disable — second timestamp should be ≥ first.
      await new Promise((resolve) => setTimeout(resolve, 50));
      await withTenant(TENANT, async (tx) => {
        await disableUserInDb(tx, { authUserId: AUTH_USER_A });
      });

      const secondTs = await withServiceRole("capture second disabled_at", async (tx) => {
        type Row = { disabled_at: string };
        const rows = await tx.execute<Row>(sqlTag`
          SELECT disabled_at::text AS disabled_at FROM users WHERE id = ${AUTH_USER_A}
        `);
        return rows[0].disabled_at;
      });
      expect(secondTs >= firstTs).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // enableUserInDb
  // -------------------------------------------------------------------------

  describe("enableUserInDb", () => {
    it("clears disabled_at to NULL", async () => {
      // Precondition: User A was disabled in the previous block.
      await withTenant(TENANT, async (tx) => {
        await enableUserInDb(tx, { authUserId: AUTH_USER_A });
      });

      await withServiceRole("verify disabled_at cleared", async (tx) => {
        type Row = { disabled_at: Date | string | null };
        const rows = await tx.execute<Row>(sqlTag`
          SELECT disabled_at FROM users WHERE id = ${AUTH_USER_A}
        `);
        expect(rows[0].disabled_at).toBeNull();
      });
    });

    it("is idempotent — re-enabling an already-enabled user is a no-op", async () => {
      await withTenant(TENANT, async (tx) => {
        await enableUserInDb(tx, { authUserId: AUTH_USER_A });
      });
      await withServiceRole("re-verify disabled_at null", async (tx) => {
        type Row = { disabled_at: Date | string | null };
        const rows = await tx.execute<Row>(sqlTag`
          SELECT disabled_at FROM users WHERE id = ${AUTH_USER_A}
        `);
        expect(rows[0].disabled_at).toBeNull();
      });
    });
  });

  // -------------------------------------------------------------------------
  // listAllUsers — verify the Status column data
  // -------------------------------------------------------------------------

  describe("listAllUsers — disabledAt projection", () => {
    it("surfaces disabledAt=null for active users and a timestamp for disabled users", async () => {
      // User A enabled (just re-enabled above); disable User B for
      // the cross-state assertion.
      await withTenant(TENANT, async (tx) => {
        await disableUserInDb(tx, { authUserId: AUTH_USER_B });
      });

      const ctx = transcorpStaffCtx();
      const rows = await listAllUsers(ctx, { searchTerm: `-${RUN_ID}@` });
      const aRow = rows.find((r) => r.userId === AUTH_USER_A);
      const bRow = rows.find((r) => r.userId === AUTH_USER_B);
      expect(aRow).toBeDefined();
      expect(bRow).toBeDefined();
      expect(aRow?.disabledAt).toBeNull();
      expect(bRow?.disabledAt).not.toBeNull();
      // Sanity check on shape — timestamp-like string. Postgres returns
      // either ISO ("2026-05-13T...") or text-format ("2026-05-13 ...")
      // depending on the connection/serialization path; accept both.
      expect(bRow?.disabledAt).toMatch(/^\d{4}-\d{2}-\d{2}[ T]/);
    });
  });
});
