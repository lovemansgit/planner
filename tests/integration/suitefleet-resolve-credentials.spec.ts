// tests/integration/suitefleet-resolve-credentials.spec.ts
// =============================================================================
// Day-26 T3 — real-Postgres coverage for resolveSuiteFleetCredentials's
// fail-closed posture. Spec 5 of 8 for the per-merchant SF credentials
// lane (Sub-PR 2). The OAuth happy path's shape is asserted here; the
// dual-branch (oauth + api_key) discriminator coverage lives in spec 8
// (suitefleet-resolve-credentials-discriminated-union.spec.ts).
//
// Cases pinned:
//   1. happy path (OAuth region) — resolver returns discriminated-union
//      value with auth_method='oauth' and the correct field set
//   2. fail-closed when both Vault UUIDs are NULL (credentials not configured)
//   3. fail-closed when the parent region is inactive
//   4. fail-closed when customer_code is missing
//   5. fail-closed when the tenant row is absent
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { resolveSuiteFleetCredentials, storeSuitefleetCredentials } from "../../src/modules/credentials";
import { withServiceRole } from "../../src/shared/db";
import { CredentialError } from "../../src/shared/errors";
import type { RequestContext } from "../../src/shared/tenant-context";
import type { Permission, Uuid } from "../../src/shared/types";

const RUN_ID = randomUUID().slice(0, 8);
const TENANT_HAPPY = randomUUID();
const TENANT_VAULT_NULL = randomUUID();
const TENANT_REGION_INACTIVE = randomUUID();
const TENANT_NO_CUSTOMER_CODE = randomUUID();
const SLUG_HAPPY = `src-${RUN_ID}-happy`;
const SLUG_VAULT_NULL = `src-${RUN_ID}-vnull`;
const SLUG_REGION_INACTIVE = `src-${RUN_ID}-inact`;
const SLUG_NO_CUST = `src-${RUN_ID}-nocust`;

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

let inactiveRegionId: Uuid;

describe("suitefleet resolve credentials — integration (Day-26 T3)", () => {
  beforeAll(async () => {
    // Use the seeded sandbox region (auth_method='oauth') for the
    // happy-path tenant + the vault-null + no-customer-code tenants.
    // Create a fresh region for the region-inactive case so we can
    // flip its status to 'inactive' without affecting the seeded
    // sandbox row.
    await withServiceRole("src setup", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, status, suitefleet_customer_code)
        VALUES
          (${TENANT_HAPPY}, ${SLUG_HAPPY}, 'SRC Happy', 'active', '588'),
          (${TENANT_VAULT_NULL}, ${SLUG_VAULT_NULL}, 'SRC Vault Null', 'active', '588'),
          (${TENANT_NO_CUSTOMER_CODE}, ${SLUG_NO_CUST}, 'SRC No Customer Code', 'active', NULL)
      `);

      const regionRows = await tx.execute<{ id: string } & Record<string, unknown>>(sqlTag`
        INSERT INTO suitefleet_regions (client_id, display_name, auth_method, status)
        VALUES (${`srcinact${RUN_ID.replace(/[^a-z]/g, "x").slice(0, 4)}`}, 'SRC Inactive Region', 'api_key', 'inactive')
        RETURNING id
      `);
      inactiveRegionId = (regionRows as unknown as ReadonlyArray<{ id: string }>)[0].id as Uuid;

      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, status, suitefleet_customer_code, suitefleet_region_id)
        VALUES (${TENANT_REGION_INACTIVE}, ${SLUG_REGION_INACTIVE}, 'SRC Region Inactive Tenant', 'active', '588', ${inactiveRegionId})
      `);
    });

    // Populate Vault credentials on the happy-path tenant only — the
    // region-inactive + no-customer-code tenants also need Vault rows
    // so the resolver reaches the relevant fail-closed branch (not the
    // credentials-not-configured branch).
    const noop = vi.fn();
    await storeSuitefleetCredentials(
      sysadminCtx("happy-cred"),
      TENANT_HAPPY as Uuid,
      { credential1: "happy-username", credential2: "happy-password" },
      noop,
    );
    await storeSuitefleetCredentials(
      sysadminCtx("inact-cred"),
      TENANT_REGION_INACTIVE as Uuid,
      { credential1: "inact-username", credential2: "inact-password" },
      noop,
    );
    await storeSuitefleetCredentials(
      sysadminCtx("nocust-cred"),
      TENANT_NO_CUSTOMER_CODE as Uuid,
      { credential1: "nocust-username", credential2: "nocust-password" },
      noop,
    );
  });

  afterAll(async () => {
    try {
      await withServiceRole("src teardown — tenants", async (tx) => {
        await tx.execute(sqlTag`
          DELETE FROM tenants
          WHERE id IN (${TENANT_HAPPY}, ${TENANT_VAULT_NULL}, ${TENANT_REGION_INACTIVE}, ${TENANT_NO_CUSTOMER_CODE})
        `);
      });
    } catch {
      /* audit RULE; ignore */
    }
    try {
      await withServiceRole("src teardown — region", async (tx) => {
        await tx.execute(sqlTag`DELETE FROM suitefleet_regions WHERE id = ${inactiveRegionId}`);
      });
    } catch {
      /* FK RESTRICT if tenant leaked; ignore */
    }
  });

  it("happy path (sandbox / oauth region) — returns oauth-branch discriminated-union value", async () => {
    const creds = await resolveSuiteFleetCredentials(TENANT_HAPPY as Uuid);
    expect(creds.auth_method).toBe("oauth");
    if (creds.auth_method === "oauth") {
      expect(creds.clientId).toBe("transcorpsb");
      expect(creds.customerId).toBe(588);
      expect(creds.username).toBe("happy-username");
      expect(creds.password).toBe("happy-password");
    }
  });

  it("fail-closed: both Vault UUIDs NULL → CredentialError(credentials not configured)", async () => {
    await expect(
      resolveSuiteFleetCredentials(TENANT_VAULT_NULL as Uuid),
    ).rejects.toBeInstanceOf(CredentialError);
  });

  it("fail-closed: region.status = 'inactive' → CredentialError", async () => {
    await expect(
      resolveSuiteFleetCredentials(TENANT_REGION_INACTIVE as Uuid),
    ).rejects.toBeInstanceOf(CredentialError);
  });

  it("fail-closed: customer_code NULL → CredentialError", async () => {
    await expect(
      resolveSuiteFleetCredentials(TENANT_NO_CUSTOMER_CODE as Uuid),
    ).rejects.toBeInstanceOf(CredentialError);
  });

  it("fail-closed: unknown tenantId → CredentialError(tenant row not found)", async () => {
    const ghost = randomUUID();
    await expect(
      resolveSuiteFleetCredentials(ghost as Uuid),
    ).rejects.toBeInstanceOf(CredentialError);
  });
});
