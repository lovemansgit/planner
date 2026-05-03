// /admin/webhook-config integration tests (Day 9 / P4a).
//
// Two coverage goals:
//   1. RBAC at the queries layer — actor with permission gets data,
//      actor without permission gets ForbiddenError
//   2. Cross-tenant probe — tenant A's actor calling
//      tier2CredentialsConfigured cannot see tenant B's credentials
//      row (RLS via withTenant gates the read; defence-in-depth
//      against accidentally leaking the existence boolean cross-tenant)
//
// The underlying RLS at the table layer is already exhaustively
// tested in tests/integration/rls-tenant-isolation.spec.ts §
// "tenant_suitefleet_webhook_credentials". This file's purpose is to
// confirm the queries module composes (permission + withTenant + SQL)
// correctly so the cross-tenant guarantee carries through to the
// service-layer call, not just the raw table.

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ROLES } from "../../src/modules/identity";
import {
  countTier2MismatchesLast24h,
  tier2CredentialsConfigured,
} from "../../src/modules/webhooks";
import { withServiceRole } from "../../src/shared/db";
import { ForbiddenError } from "../../src/shared/errors";
import type { RequestContext } from "../../src/shared/tenant-context";
import type { Permission } from "../../src/shared/types";

const RUN_ID = randomUUID().slice(0, 8);
const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const SLUG_A = `p4a-test-${RUN_ID}-a`;
const SLUG_B = `p4a-test-${RUN_ID}-b`;

// Bcrypt-shaped placeholder; this test doesn't exercise hash
// semantics — only RLS scoping on the credentials table.
const FAKE_HASH = `$2a$10$p4acreds${RUN_ID}placeholderhashforintegrationtest`;

const TENANT_ADMIN_PERMS = ROLES["tenant-admin"].permissions;
const CS_AGENT_PERMS = ROLES["cs-agent"].permissions;

function makeCtx(tenantId: string, perms: ReadonlySet<Permission>): RequestContext {
  return {
    actor: {
      kind: "user",
      userId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
      tenantId,
      permissions: perms,
    },
    tenantId,
    requestId: randomUUID(),
    path: "/admin/webhook-config",
  };
}

describe("P4a — /admin/webhook-config queries (RBAC + cross-tenant)", () => {
  beforeAll(async () => {
    // Seed two tenants and ONE credentials row, attached to TENANT_B
    // only. Cross-tenant probe asserts TENANT_A cannot see it.
    await withServiceRole("P4a integration-test setup", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name) VALUES
          (${TENANT_A}, ${SLUG_A}, 'P4a Test Tenant A'),
          (${TENANT_B}, ${SLUG_B}, 'P4a Test Tenant B')
      `);
      await tx.execute(sqlTag`
        INSERT INTO tenant_suitefleet_webhook_credentials (
          tenant_id, client_id, client_secret_hash
        ) VALUES (
          ${TENANT_B}, 'p4a-creds-tenant-b', ${FAKE_HASH}
        )
      `);
    });
  });

  afterAll(async () => {
    await withServiceRole("P4a integration-test cleanup", async (tx) => {
      await tx.execute(sqlTag`
        DELETE FROM tenant_suitefleet_webhook_credentials
        WHERE tenant_id IN (${TENANT_A}, ${TENANT_B})
      `);
      await tx.execute(sqlTag`
        DELETE FROM tenants WHERE id IN (${TENANT_A}, ${TENANT_B})
      `);
    });
  });

  describe("RBAC", () => {
    it("countTier2MismatchesLast24h: Tenant Admin actor succeeds", async () => {
      const ctx = makeCtx(TENANT_B, TENANT_ADMIN_PERMS);
      const result = await countTier2MismatchesLast24h(ctx);
      expect(result.count).toBe(0);
    });

    it("tier2CredentialsConfigured: Tenant Admin actor succeeds", async () => {
      const ctx = makeCtx(TENANT_B, TENANT_ADMIN_PERMS);
      const result = await tier2CredentialsConfigured(ctx);
      expect(result).toBe(true);
    });

    it("countTier2MismatchesLast24h: CS Agent actor throws ForbiddenError", async () => {
      const ctx = makeCtx(TENANT_B, CS_AGENT_PERMS);
      await expect(countTier2MismatchesLast24h(ctx)).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("tier2CredentialsConfigured: CS Agent actor throws ForbiddenError", async () => {
      const ctx = makeCtx(TENANT_B, CS_AGENT_PERMS);
      await expect(tier2CredentialsConfigured(ctx)).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe("cross-tenant existence-oracle masking", () => {
    it("tier2CredentialsConfigured: tenant A's actor cannot see tenant B's creds row", async () => {
      // Even though TENANT_B has a real credentials row, TENANT_A's
      // actor querying via tier2CredentialsConfigured (which scopes
      // via withTenant(TENANT_A)) gets RLS-filtered to zero rows and
      // sees "not configured."
      const ctxA = makeCtx(TENANT_A, TENANT_ADMIN_PERMS);
      const result = await tier2CredentialsConfigured(ctxA);
      expect(result).toBe(false);
    });

    it("tier2CredentialsConfigured: tenant B's actor sees its own creds row", async () => {
      // Sanity check the seeding actually landed; without this the
      // negative test above could pass for the wrong reason (e.g.
      // failed insert).
      const ctxB = makeCtx(TENANT_B, TENANT_ADMIN_PERMS);
      const result = await tier2CredentialsConfigured(ctxB);
      expect(result).toBe(true);
    });

    it("countTier2MismatchesLast24h: tenant A's actor sees zero (no audit_events leaked)", async () => {
      const ctxA = makeCtx(TENANT_A, TENANT_ADMIN_PERMS);
      const result = await countTier2MismatchesLast24h(ctxA);
      expect(result.count).toBe(0);
    });
  });
});
