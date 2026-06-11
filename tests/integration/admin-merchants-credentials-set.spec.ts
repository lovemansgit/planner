// tests/integration/admin-merchants-credentials-set.spec.ts
// =============================================================================
// Day-26 T3 — real-Postgres coverage for the storeSuitefleetCredentials
// service's initial-set path. Spec 3 of 8 for the per-merchant SF
// credentials lane (Sub-PR 2).
//
// Cases pinned:
//   1. happy path — both Vault rows created via vault.create_secret,
//      tenant row stores both Vault UUIDs, credentials.set audit emitted
//      with classifier='initial-set' AND payload === { tenant_id,
//      classifier } only (no plaintext, no vault UUIDs, no auth_method)
//   2. token cache invalidation hook called on initial-set per OQ-5
//   3. permission gate — actor without merchant:update → ForbiddenError
//   4. NotFoundError on unknown tenantId
//   5. ConflictError on mixed-state vault columns (one set, one NULL)
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { storeSuitefleetCredentials } from "../../src/modules/credentials";
import { withServiceRole } from "../../src/shared/db";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../../src/shared/errors";
import type { RequestContext } from "../../src/shared/tenant-context";
import type { Permission, Uuid } from "../../src/shared/types";

const RUN_ID = randomUUID().slice(0, 8);
const TENANT_INITIAL = randomUUID();
const TENANT_MIXED = randomUUID();
const SLUG_INITIAL = `amc-set-${RUN_ID}-init`;
const SLUG_MIXED = `amc-set-${RUN_ID}-mixed`;

const SYSADMIN_ACTOR = randomUUID();
const NON_SYSADMIN_ACTOR = randomUUID();

function sysadminCtx(): RequestContext {
  return {
    actor: {
      kind: "user",
      userId: SYSADMIN_ACTOR,
      tenantId: "00000000-0000-0000-0000-000000000000",
      permissions: new Set<Permission>(["merchant:update"]),
    },
    tenantId: null,
    requestId: `test-${RUN_ID}-set`,
    path: "/admin/merchants",
  };
}

function nonSysadminCtx(): RequestContext {
  return {
    actor: {
      kind: "user",
      userId: NON_SYSADMIN_ACTOR,
      tenantId: "00000000-0000-0000-0000-000000000000",
      permissions: new Set<Permission>(["merchant:read_all"]),
    },
    tenantId: null,
    requestId: `test-${RUN_ID}-set-forbidden`,
    path: "/admin/merchants",
  };
}

describe("admin merchants credentials set — integration (Day-26 T3)", () => {
  beforeAll(async () => {
    await withServiceRole("amc-set seed", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, status, suitefleet_customer_code)
        VALUES
          (${TENANT_INITIAL}, ${SLUG_INITIAL}, 'AMC Set Initial', 'active', '588'),
          (${TENANT_MIXED}, ${SLUG_MIXED}, 'AMC Set Mixed', 'active', '588')
      `);
      // Force mixed-state on the second tenant: bind vault_1 to a real
      // Vault row, leave vault_2 NULL.
      const rows = await tx.execute<{ id: string } & Record<string, unknown>>(sqlTag`
        SELECT vault.create_secret('amc-set-mixed-seed') AS id
      `);
      const seededVaultId = (rows as unknown as ReadonlyArray<{ id: string }>)[0].id;
      await tx.execute(sqlTag`
        UPDATE tenants
        SET suitefleet_credential_1_vault_id = ${seededVaultId}::uuid
        WHERE id = ${TENANT_MIXED}
      `);
    });
  });

  afterAll(async () => {
    // Canonical teardown — try tenant delete; audit-rule may block,
    // swallow. Random per-run tenant UUIDs prevent collision; Vault
    // rows leak with the tenant rows.
    try {
      await withServiceRole("amc-set teardown", async (tx) => {
        await tx.execute(sqlTag`
          DELETE FROM tenants WHERE id IN (${TENANT_INITIAL}, ${TENANT_MIXED})
        `);
      });
    } catch {
      /* audit RULE; ignore */
    }
  });

  it("happy path — initial-set writes both Vault rows + binds tenant + emits credentials.set", async () => {
    const invalidateSession = vi.fn();

    const result = await storeSuitefleetCredentials(
      sysadminCtx(),
      TENANT_INITIAL as Uuid,
      { credential1: "username-fixture", credential2: "password-fixture" },
      invalidateSession,
    );

    expect(result).toEqual({
      status: "stored",
      tenantId: TENANT_INITIAL,
      classifier: "initial-set",
    });

    // Vault UUIDs persisted on the tenant row + both Vault rows
    // hold the supplied plaintexts.
    const data = await withServiceRole("test:read vault bind", async (tx) => {
      const tenantRows = await tx.execute<{
        suitefleet_credential_1_vault_id: string | null;
        suitefleet_credential_2_vault_id: string | null;
      } & Record<string, unknown>>(sqlTag`
        SELECT suitefleet_credential_1_vault_id, suitefleet_credential_2_vault_id
        FROM tenants
        WHERE id = ${TENANT_INITIAL}
      `);
      const tenant = (tenantRows as unknown as ReadonlyArray<{
        suitefleet_credential_1_vault_id: string | null;
        suitefleet_credential_2_vault_id: string | null;
      }>)[0];
      const secretRows = await tx.execute<{ id: string; decrypted_secret: string } & Record<string, unknown>>(sqlTag`
        SELECT id, decrypted_secret
        FROM vault.decrypted_secrets
        WHERE id IN (
          ${tenant.suitefleet_credential_1_vault_id}::uuid,
          ${tenant.suitefleet_credential_2_vault_id}::uuid
        )
      `);
      return { tenant, secrets: secretRows as unknown as ReadonlyArray<{ id: string; decrypted_secret: string }> };
    });
    expect(data.tenant.suitefleet_credential_1_vault_id).not.toBeNull();
    expect(data.tenant.suitefleet_credential_2_vault_id).not.toBeNull();
    const plaintextsByUuid = new Map(data.secrets.map((s) => [s.id, s.decrypted_secret]));
    expect(plaintextsByUuid.get(data.tenant.suitefleet_credential_1_vault_id as string)).toBe(
      "username-fixture",
    );
    expect(plaintextsByUuid.get(data.tenant.suitefleet_credential_2_vault_id as string)).toBe(
      "password-fixture",
    );

    // Audit event payload is EXACTLY { tenant_id, classifier } — no
    // plaintext, no vault UUIDs, no auth_method per OQ-8 shape divergence.
    const events = await withServiceRole("test:select credentials.set", async (tx) => {
      return tx.execute<{ event_type: string; resource_id: string; metadata: Record<string, unknown> } & Record<string, unknown>>(sqlTag`
        SELECT event_type, resource_id, metadata
        FROM audit_events
        WHERE event_type = 'credentials.set' AND resource_id = ${TENANT_INITIAL}
        ORDER BY occurred_at ASC
      `);
    });
    expect(events).toHaveLength(1);
    expect(events[0].metadata).toEqual({
      tenant_id: TENANT_INITIAL,
      classifier: "initial-set",
    });
    // Defense-in-depth pin: plaintext absent from the JSONB payload.
    const serialised = JSON.stringify(events[0].metadata);
    expect(serialised).not.toContain("username-fixture");
    expect(serialised).not.toContain("password-fixture");
    expect(serialised).not.toContain(data.tenant.suitefleet_credential_1_vault_id as string);
    expect(serialised).not.toContain(data.tenant.suitefleet_credential_2_vault_id as string);

    // Token cache invalidation hook called per OQ-5.
    expect(invalidateSession).toHaveBeenCalledTimes(1);
    expect(invalidateSession).toHaveBeenCalledWith(TENANT_INITIAL);
  });

  it("permission gate — actor without merchant:update throws ForbiddenError + no audit emitted", async () => {
    const invalidateSession = vi.fn();
    await expect(
      storeSuitefleetCredentials(
        nonSysadminCtx(),
        TENANT_INITIAL as Uuid,
        { credential1: "x", credential2: "y" },
        invalidateSession,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(invalidateSession).not.toHaveBeenCalled();
  });

  it("NotFoundError on unknown tenantId", async () => {
    const ghost = randomUUID();
    const invalidateSession = vi.fn();
    await expect(
      storeSuitefleetCredentials(
        sysadminCtx(),
        ghost as Uuid,
        { credential1: "x", credential2: "y" },
        invalidateSession,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(invalidateSession).not.toHaveBeenCalled();
  });

  it("ConflictError on mixed-state vault columns (operational anomaly surfaces)", async () => {
    const invalidateSession = vi.fn();
    await expect(
      storeSuitefleetCredentials(
        sysadminCtx(),
        TENANT_MIXED as Uuid,
        { credential1: "x", credential2: "y" },
        invalidateSession,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(invalidateSession).not.toHaveBeenCalled();
  });
});
