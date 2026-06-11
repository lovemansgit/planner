// tests/integration/suitefleet-resolve-credentials-discriminated-union.spec.ts
// =============================================================================
// Day-26 T3 — assertion that resolveSuiteFleetCredentials returns the
// correct discriminator + field set per region.auth_method. Spec 8 of 8
// for the per-merchant SF credentials lane (Sub-PR 2). Companion to
// spec 5 (suitefleet-resolve-credentials.spec.ts) which covers the
// fail-closed cases on the OAuth branch.
//
// Cases pinned:
//   1. OAuth-region tenant — resolver returns { auth_method: 'oauth',
//      clientId, customerId, username, password } with the exact
//      plaintext written via storeSuitefleetCredentials
//   2. api_key-region tenant — resolver returns { auth_method:
//      'api_key', clientId, customerId, apiKey, secretKey } with the
//      exact plaintext written
//   3. Exhaustiveness pin — the auth_method switch at the login()
//      callsite is enforced at compile-time by tsc; a non-exhaustive
//      switch fails to typecheck. This is verified by the build itself
//      (tsc green is the pin); included here as a comment + a runtime
//      sanity that the auth-method enum has exactly the two known
//      values seeded by migration 0024.
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { resolveSuiteFleetCredentials, storeSuitefleetCredentials } from "../../src/modules/credentials";
import { withServiceRole } from "../../src/shared/db";
import type { RequestContext } from "../../src/shared/tenant-context";
import type { Permission, Uuid } from "../../src/shared/types";

const RUN_ID = randomUUID().slice(0, 8);
const TENANT_OAUTH = randomUUID();
const TENANT_API_KEY = randomUUID();
const SLUG_OAUTH = `srdu-${RUN_ID}-oauth`;
const SLUG_API_KEY = `srdu-${RUN_ID}-api-key`;

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
    requestId: `test-${RUN_ID}-${label}`,
    path: "/admin/merchants",
  };
}

describe("suitefleet resolve credentials — discriminated union (Day-26 T3)", () => {
  beforeAll(async () => {
    // Use the migration-seeded sandbox (oauth) + transcorp (api_key)
    // regions directly. The DEFAULT clause on tenants.suitefleet_region_id
    // points at sandbox; the api_key-region tenant is wired to
    // 'transcorp' explicitly.
    await withServiceRole("srdu setup", async (tx) => {
      const regionRows = await tx.execute<{ id: string } & Record<string, unknown>>(sqlTag`
        SELECT id FROM suitefleet_regions WHERE client_id = 'transcorp'
      `);
      const apiKeyRegionId = (regionRows as unknown as ReadonlyArray<{ id: string }>)[0]?.id;
      if (apiKeyRegionId === undefined) {
        throw new Error(
          "srdu setup: the 'transcorp' region must exist (seeded by migration 0024); spec cannot run without it",
        );
      }

      await tx.execute(sqlTag`
        INSERT INTO tenants (
          id, slug, name, status, suitefleet_customer_code
        ) VALUES (
          ${TENANT_OAUTH}, ${SLUG_OAUTH}, 'SRDU OAuth Tenant', 'active', '588'
        )
      `);
      await tx.execute(sqlTag`
        INSERT INTO tenants (
          id, slug, name, status, suitefleet_customer_code, suitefleet_region_id
        ) VALUES (
          ${TENANT_API_KEY}, ${SLUG_API_KEY}, 'SRDU API Key Tenant', 'active', '700', ${apiKeyRegionId}
        )
      `);
    });

    // Bind credentials to both tenants via the service so the audit
    // emit/vault-write paths are exercised end-to-end.
    const noop = vi.fn();
    await storeSuitefleetCredentials(
      sysadminCtx("oauth-cred"),
      TENANT_OAUTH as Uuid,
      { credential1: "oauth-username-fixture", credential2: "oauth-password-fixture" },
      noop,
    );
    await storeSuitefleetCredentials(
      sysadminCtx("apikey-cred"),
      TENANT_API_KEY as Uuid,
      { credential1: "apikey-key-fixture", credential2: "apikey-secret-fixture" },
      noop,
    );
  });

  afterAll(async () => {
    try {
      await withServiceRole("srdu teardown", async (tx) => {
        await tx.execute(sqlTag`
          DELETE FROM tenants WHERE id IN (${TENANT_OAUTH}, ${TENANT_API_KEY})
        `);
      });
    } catch {
      /* audit RULE; ignore */
    }
  });

  it("OAuth-region tenant → resolver returns oauth-branch fields with the persisted plaintexts", async () => {
    const creds = await resolveSuiteFleetCredentials(TENANT_OAUTH as Uuid);
    expect(creds.auth_method).toBe("oauth");
    if (creds.auth_method === "oauth") {
      expect(creds.clientId).toBe("transcorpsb");
      expect(creds.customerId).toBe(588);
      expect(creds.username).toBe("oauth-username-fixture");
      expect(creds.password).toBe("oauth-password-fixture");
      // Type narrowing pin: the api_key fields must NOT appear on the
      // oauth branch (tsc enforces; runtime sanity here).
      const keys = Object.keys(creds).sort();
      expect(keys).toEqual(
        ["auth_method", "clientId", "customerId", "password", "username"].sort(),
      );
    }
  });

  it("api_key-region tenant → resolver returns api_key-branch fields with the persisted plaintexts", async () => {
    const creds = await resolveSuiteFleetCredentials(TENANT_API_KEY as Uuid);
    expect(creds.auth_method).toBe("api_key");
    if (creds.auth_method === "api_key") {
      expect(creds.clientId).toBe("transcorp");
      expect(creds.customerId).toBe(700);
      expect(creds.apiKey).toBe("apikey-key-fixture");
      expect(creds.secretKey).toBe("apikey-secret-fixture");
      const keys = Object.keys(creds).sort();
      expect(keys).toEqual(
        ["apiKey", "auth_method", "clientId", "customerId", "secretKey"].sort(),
      );
    }
  });

  it("auth_method enum is exhausted by the two seeded values (compile-time exhaustiveness backstop)", async () => {
    // The auth-client login() switch over auth_method is verified
    // exhaustive at compile time (tsc rejects a non-exhaustive switch
    // — the `const _exhaustive: never = credentials` line in
    // auth-client.ts:login() does the typing work). This runtime
    // sanity confirms the seeded enum values are exactly the two
    // covered branches; any future widening of the CHECK constraint
    // forces both the SQL CHECK and the discriminated-union TypeScript
    // type to add the new branch in lockstep.
    const rows = await withServiceRole("test:enum check", async (tx) => {
      return tx.execute<{ auth_method: string } & Record<string, unknown>>(sqlTag`
        SELECT DISTINCT auth_method FROM suitefleet_regions ORDER BY auth_method
      `);
    });
    const methods = (rows as unknown as ReadonlyArray<{ auth_method: string }>)
      .map((r) => r.auth_method)
      .sort();
    expect(methods).toEqual(["api_key", "oauth"]);
  });
});
