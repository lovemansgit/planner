// tests/integration/admin-merchants-credentials-rotate.spec.ts
// =============================================================================
// Day-26 T3 — real-Postgres coverage for the storeSuitefleetCredentials
// service's rotation path. Spec 4 of 8 for the per-merchant SF
// credentials lane (Sub-PR 2).
//
// Cases pinned:
//   1. happy path — second storeSuitefleetCredentials call against a
//      tenant whose Vault UUIDs are both populated takes the rotation
//      path: vault.update_secret on each existing UUID (preserves the
//      UUIDs themselves), Vault plaintext now reflects the rotated
//      value, credentials.set emitted with classifier='rotation', and
//      the token cache invalidation hook fires per OQ-5.
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { storeSuitefleetCredentials } from "../../src/modules/credentials";
import { withServiceRole } from "../../src/shared/db";
import type { RequestContext } from "../../src/shared/tenant-context";
import type { Permission, Uuid } from "../../src/shared/types";

const RUN_ID = randomUUID().slice(0, 8);
const TENANT_ROT = randomUUID();
const SLUG_ROT = `amc-rot-${RUN_ID}`;

const SYSADMIN_ACTOR = randomUUID();

function sysadminCtx(label: string): RequestContext {
  return {
    actor: {
      kind: "user",
      userId: SYSADMIN_ACTOR,
      tenantId: "00000000-0000-0000-0000-000000000000",
      permissions: new Set<Permission>(["merchant:update"]),
    },
    tenantId: null,
    requestId: `test-${RUN_ID}-rot-${label}`,
    path: "/admin/merchants",
  };
}

describe("admin merchants credentials rotate — integration (Day-26 T3)", () => {
  beforeAll(async () => {
    await withServiceRole("amc-rot seed", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, status, suitefleet_customer_code)
        VALUES (${TENANT_ROT}, ${SLUG_ROT}, 'AMC Rotation Tenant', 'active', '588')
      `);
    });
  });

  afterAll(async () => {
    try {
      await withServiceRole("amc-rot teardown", async (tx) => {
        await tx.execute(sqlTag`DELETE FROM tenants WHERE id = ${TENANT_ROT}`);
      });
    } catch {
      /* audit RULE; ignore */
    }
  });

  it("rotation preserves Vault UUIDs, rotates plaintext, emits classifier='rotation', invalidates token cache", async () => {
    // Initial-set (first call).
    const invalidateInitial = vi.fn();
    const initial = await storeSuitefleetCredentials(
      sysadminCtx("initial"),
      TENANT_ROT as Uuid,
      { credential1: "initial-cred-1", credential2: "initial-cred-2" },
      invalidateInitial,
    );
    expect(initial.classifier).toBe("initial-set");
    expect(invalidateInitial).toHaveBeenCalledOnce();

    // Snapshot the bound Vault UUIDs.
    const initialBind = await withServiceRole("test:read initial bind", async (tx) => {
      const rows = await tx.execute<{
        suitefleet_credential_1_vault_id: string;
        suitefleet_credential_2_vault_id: string;
      } & Record<string, unknown>>(sqlTag`
        SELECT suitefleet_credential_1_vault_id, suitefleet_credential_2_vault_id
        FROM tenants
        WHERE id = ${TENANT_ROT}
      `);
      return (rows as unknown as ReadonlyArray<{
        suitefleet_credential_1_vault_id: string;
        suitefleet_credential_2_vault_id: string;
      }>)[0];
    });

    // Rotation (second call).
    const invalidateRotate = vi.fn();
    const rotation = await storeSuitefleetCredentials(
      sysadminCtx("rotate"),
      TENANT_ROT as Uuid,
      { credential1: "rotated-cred-1", credential2: "rotated-cred-2" },
      invalidateRotate,
    );
    expect(rotation.classifier).toBe("rotation");
    expect(invalidateRotate).toHaveBeenCalledOnce();
    expect(invalidateRotate).toHaveBeenCalledWith(TENANT_ROT);

    // Vault UUIDs PRESERVED across rotation.
    const rotatedBind = await withServiceRole("test:read rotated bind", async (tx) => {
      const rows = await tx.execute<{
        suitefleet_credential_1_vault_id: string;
        suitefleet_credential_2_vault_id: string;
      } & Record<string, unknown>>(sqlTag`
        SELECT suitefleet_credential_1_vault_id, suitefleet_credential_2_vault_id
        FROM tenants
        WHERE id = ${TENANT_ROT}
      `);
      return (rows as unknown as ReadonlyArray<{
        suitefleet_credential_1_vault_id: string;
        suitefleet_credential_2_vault_id: string;
      }>)[0];
    });
    expect(rotatedBind.suitefleet_credential_1_vault_id).toBe(
      initialBind.suitefleet_credential_1_vault_id,
    );
    expect(rotatedBind.suitefleet_credential_2_vault_id).toBe(
      initialBind.suitefleet_credential_2_vault_id,
    );

    // Vault plaintext now reflects the rotated values.
    const secrets = await withServiceRole("test:read vault plaintext", async (tx) => {
      const rows = await tx.execute<{ id: string; decrypted_secret: string } & Record<string, unknown>>(sqlTag`
        SELECT id, decrypted_secret
        FROM vault.decrypted_secrets
        WHERE id IN (
          ${rotatedBind.suitefleet_credential_1_vault_id}::uuid,
          ${rotatedBind.suitefleet_credential_2_vault_id}::uuid
        )
      `);
      return rows as unknown as ReadonlyArray<{ id: string; decrypted_secret: string }>;
    });
    const plaintextsByUuid = new Map(secrets.map((s) => [s.id, s.decrypted_secret]));
    expect(plaintextsByUuid.get(rotatedBind.suitefleet_credential_1_vault_id)).toBe(
      "rotated-cred-1",
    );
    expect(plaintextsByUuid.get(rotatedBind.suitefleet_credential_2_vault_id)).toBe(
      "rotated-cred-2",
    );

    // Two credentials.set events for this tenant — one initial-set,
    // one rotation. Both payloads are { tenant_id, classifier } only.
    const events = await withServiceRole("test:select credentials.set events", async (tx) => {
      return tx.execute<{ event_type: string; resource_id: string; metadata: Record<string, unknown> } & Record<string, unknown>>(sqlTag`
        SELECT event_type, resource_id, metadata
        FROM audit_events
        WHERE event_type = 'credentials.set' AND resource_id = ${TENANT_ROT}
        ORDER BY occurred_at ASC
      `);
    });
    expect(events).toHaveLength(2);
    expect(events[0].metadata).toEqual({ tenant_id: TENANT_ROT, classifier: "initial-set" });
    expect(events[1].metadata).toEqual({ tenant_id: TENANT_ROT, classifier: "rotation" });
    for (const ev of events) {
      const serialised = JSON.stringify(ev.metadata);
      expect(serialised).not.toContain("initial-cred-1");
      expect(serialised).not.toContain("initial-cred-2");
      expect(serialised).not.toContain("rotated-cred-1");
      expect(serialised).not.toContain("rotated-cred-2");
      expect(serialised).not.toContain(rotatedBind.suitefleet_credential_1_vault_id);
      expect(serialised).not.toContain(rotatedBind.suitefleet_credential_2_vault_id);
    }
  });
});
