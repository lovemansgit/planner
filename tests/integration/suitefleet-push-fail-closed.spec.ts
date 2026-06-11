// tests/integration/suitefleet-push-fail-closed.spec.ts
// =============================================================================
// Day-26 T3 — real-Postgres coverage for the SF push path's fail-closed
// posture when credentials are not configured. Spec 6 of 8 for the
// per-merchant SF credentials lane (Sub-PR 2).
//
// The plan's spec target is "pushSingleTask throws / returns expected
// fail-closed result when credentials not configured." pushSingleTask's
// credentials-touching layer is the adapter.authenticate call — which
// flows through tokenCache → resolveSuiteFleetCredentials. Setting up
// the full task + consignee + address fixture stack just to reach the
// same throw site as adapter.authenticate(tenantId) would add 200+
// lines of irrelevant fixture noise. This spec asserts the fail-closed
// behavior at the load-bearing layer (adapter.authenticate) — the
// throw site pushSingleTask hits — which is the cleanest pin of the
// invariant.
//
// Cases pinned:
//   1. adapter.authenticate throws CredentialError when both Vault
//      UUIDs are NULL (credentials not configured for this merchant)
//   2. adapter.authenticate throws CredentialError when the parent
//      region is inactive (operational kill-switch per brief §3.7)
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createSuiteFleetLastMileAdapter } from "../../src/modules/integration/providers/suitefleet/last-mile-adapter-factory";
import { withServiceRole } from "../../src/shared/db";
import { CredentialError } from "../../src/shared/errors";
import type { Uuid } from "../../src/shared/types";

const RUN_ID = randomUUID().slice(0, 8);
const TENANT_NULL_VAULT = randomUUID();
const TENANT_INACTIVE_REGION = randomUUID();
const SLUG_NULL = `pfc-${RUN_ID}-null`;
const SLUG_INACTIVE = `pfc-${RUN_ID}-inact`;

let inactiveRegionId: Uuid;

// Fail-loud fetch — if the adapter ever reaches the network with these
// fixtures, the test must fail rather than silently exercise unmocked
// SF endpoints.
const failingFetch: typeof globalThis.fetch = async () => {
  throw new Error(
    "fail-loud: adapter must fail closed BEFORE any network call when credentials are not configured",
  );
};

function makeAdapter() {
  return createSuiteFleetLastMileAdapter({
    fetch: failingFetch,
    clock: () => new Date(),
  });
}

describe("suitefleet push fail-closed — integration (Day-26 T3)", () => {
  beforeAll(async () => {
    await withServiceRole("pfc setup", async (tx) => {
      // TENANT_NULL_VAULT: default-binds to sandbox region via the
      // migration DEFAULT clause; Vault columns stay NULL.
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, status, suitefleet_customer_code)
        VALUES (${TENANT_NULL_VAULT}, ${SLUG_NULL}, 'PFC Null Vault Tenant', 'active', '588')
      `);

      // Seed an inactive region + a tenant pointing at it. The tenant
      // gets Vault credentials so the resolver's failure is gated by
      // the inactive region (not by missing credentials).
      const regionRows = await tx.execute<{ id: string } & Record<string, unknown>>(sqlTag`
        INSERT INTO suitefleet_regions (client_id, display_name, auth_method, status)
        VALUES (${`pfcinact${RUN_ID.replace(/[^a-z]/g, "x").slice(0, 4)}`}, 'PFC Inactive Region', 'api_key', 'inactive')
        RETURNING id
      `);
      inactiveRegionId = (regionRows as unknown as ReadonlyArray<{ id: string }>)[0].id as Uuid;

      const vaultRows = await tx.execute<{ id: string } & Record<string, unknown>>(sqlTag`
        SELECT vault.create_secret('pfc-inactive-cred-1') AS id
      `);
      const v1 = (vaultRows as unknown as ReadonlyArray<{ id: string }>)[0].id;
      const vaultRows2 = await tx.execute<{ id: string } & Record<string, unknown>>(sqlTag`
        SELECT vault.create_secret('pfc-inactive-cred-2') AS id
      `);
      const v2 = (vaultRows2 as unknown as ReadonlyArray<{ id: string }>)[0].id;

      await tx.execute(sqlTag`
        INSERT INTO tenants (
          id, slug, name, status, suitefleet_customer_code,
          suitefleet_region_id,
          suitefleet_credential_1_vault_id, suitefleet_credential_2_vault_id
        ) VALUES (
          ${TENANT_INACTIVE_REGION}, ${SLUG_INACTIVE}, 'PFC Inactive Region Tenant', 'active', '588',
          ${inactiveRegionId},
          ${v1}::uuid, ${v2}::uuid
        )
      `);
    });
  });

  afterAll(async () => {
    try {
      await withServiceRole("pfc teardown — tenants", async (tx) => {
        await tx.execute(sqlTag`
          DELETE FROM tenants WHERE id IN (${TENANT_NULL_VAULT}, ${TENANT_INACTIVE_REGION})
        `);
      });
    } catch {
      /* audit RULE; ignore */
    }
    try {
      await withServiceRole("pfc teardown — region", async (tx) => {
        await tx.execute(sqlTag`DELETE FROM suitefleet_regions WHERE id = ${inactiveRegionId}`);
      });
    } catch {
      /* FK RESTRICT if tenant leaked; ignore */
    }
  });

  it("adapter.authenticate throws CredentialError when both Vault UUIDs are NULL", async () => {
    const adapter = makeAdapter();
    await expect(adapter.authenticate(TENANT_NULL_VAULT as Uuid)).rejects.toBeInstanceOf(
      CredentialError,
    );
  });

  it("adapter.authenticate throws CredentialError when the parent region is inactive", async () => {
    const adapter = makeAdapter();
    await expect(
      adapter.authenticate(TENANT_INACTIVE_REGION as Uuid),
    ).rejects.toBeInstanceOf(CredentialError);
  });
});
