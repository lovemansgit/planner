// SuiteFleet credential resolver — Day 26 / per-merchant credentials.
//
// Returns a discriminated union of per-merchant credentials. The
// `auth_method` discriminator comes from the parent `suitefleet_regions`
// row joined via `tenants.suitefleet_region_id`. Credential plaintext
// is pulled from Supabase Vault by UUID (Vault columns on the tenant
// row).
//
// Four-layer SF identifier model (brief §3.6 v1.14 + v1.15):
//   1. region.client_id     (DB, joined from tenants.suitefleet_region_id)
//   2. region.auth_method   (DB, oauth | api_key — IMMUTABLE post-create)
//   3. tenant.customer_code (DB, numeric merchant id)
//   4. credential_1 / credential_2 (Vault — semantics by region.auth_method)
//
// Read path (all inside withServiceRole):
//   1. JOIN tenants + suitefleet_regions on suitefleet_region_id; SELECT
//      customer_code + both vault UUIDs + region client_id + status +
//      auth_method.
//   2. Fail closed with CredentialError when:
//        - tenant row not found
//        - either Vault UUID is NULL
//        - region.status = 'inactive' (operational kill-switch per v1.14 OQ-2)
//        - customer_code is NULL / empty / non-positive-integer
//   3. Read both Vault secrets via readVaultSecret.
//   4. Construct the discriminated-union return value by switching on
//      region.auth_method:
//        oauth   → credential_1 = username, credential_2 = password
//        api_key → credential_1 = apiKey,   credential_2 = secretKey
//
// Failure surface returns CredentialError consistently with the prior
// resolver implementation; callers don't need to switch error class.
//
// Plaintext-handling: plaintext never logged. The debug log line on
// success carries tenant_id + source + auth_method only. The auth
// client downstream applies the documented field-level redaction in
// the logger.
//
// Fail-closed defense layers (intentional, see
// memory/followup_a1_plan_section_2_5_premise_correction.md):
//   1. β cron filter at list-cron-eligible-tenants.ts excludes tenants
//      with NULL/empty customer_code (still in force; that filter is
//      the load-bearing enumeration gate).
//   2. Per-task missing-customer_code guard at task-push/service.ts
//      remains as early short-circuit.
//   3. This resolver throws on missing customer_code, NULL vault
//      UUIDs, or inactive region — second-layer fail-closed for any
//      caller path where (1) and (2) didn't fire.

import { sql as sqlTag } from "drizzle-orm";

import { withServiceRole } from "../../shared/db";
import { CredentialError } from "../../shared/errors";
import { logger } from "../../shared/logger";
import type { Uuid } from "../../shared/types";

import type { SuiteFleetCredentials } from "./types";
import { readVaultSecret } from "./vault-store";

const RESOLVE_REASON = "credentials: resolve suitefleet";

const log = logger.with({ component: "suitefleet_credential_resolver" });

// Strict positive-integer regex: no leading zeros, no sign, no decimals.
// Rejects "0", "0588", "-5", "5.5", "5abc", "E2E-RUN_ID", etc. Canonical
// sandbox values 588 / 586 / 578 all match.
const POSITIVE_INTEGER_RE = /^[1-9]\d*$/;

interface ResolverRow {
  readonly suitefleet_customer_code: string | null;
  readonly suitefleet_credential_1_vault_id: string | null;
  readonly suitefleet_credential_2_vault_id: string | null;
  readonly region_client_id: string;
  readonly region_status: string;
  readonly region_auth_method: string;
}

export async function resolveSuiteFleetCredentials(
  tenantId: Uuid,
): Promise<SuiteFleetCredentials> {
  const row = await withServiceRole(RESOLVE_REASON, async (tx) => {
    const result = await tx.execute<ResolverRow & Record<string, unknown>>(sqlTag`
      SELECT
        t.suitefleet_customer_code,
        t.suitefleet_credential_1_vault_id,
        t.suitefleet_credential_2_vault_id,
        r.client_id   AS region_client_id,
        r.status      AS region_status,
        r.auth_method AS region_auth_method
      FROM tenants t
      JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
      WHERE t.id = ${tenantId}
      LIMIT 1
    `);
    const rows = result as unknown as ReadonlyArray<ResolverRow>;
    return rows.length > 0 ? rows[0] : null;
  });

  if (row === null) {
    log.warn({
      operation: "resolve",
      tenant_id: tenantId,
      error_code: "tenant_not_found",
    });
    throw new CredentialError(
      `SuiteFleet credentials cannot be resolved for tenant ${tenantId}: tenant row not found`,
    );
  }

  if (row.region_status !== "active") {
    log.warn({
      operation: "resolve",
      tenant_id: tenantId,
      error_code: "region_inactive",
    });
    throw new CredentialError(
      `SuiteFleet credentials cannot be resolved for tenant ${tenantId}: region '${row.region_client_id}' is inactive`,
    );
  }

  const rawCode = row.suitefleet_customer_code?.trim();
  if (!rawCode) {
    log.warn({
      operation: "resolve",
      tenant_id: tenantId,
      error_code: "missing_customer_code",
    });
    throw new CredentialError(
      `SuiteFleet credentials cannot be resolved for tenant ${tenantId}: suitefleet_customer_code is missing or empty`,
    );
  }
  if (!POSITIVE_INTEGER_RE.test(rawCode)) {
    log.warn({
      operation: "resolve",
      tenant_id: tenantId,
      error_code: "invalid_customer_code",
    });
    throw new CredentialError(
      `SuiteFleet credentials for tenant ${tenantId}: suitefleet_customer_code must be a positive integer`,
    );
  }
  const customerId = Number.parseInt(rawCode, 10);

  const vault1 = row.suitefleet_credential_1_vault_id;
  const vault2 = row.suitefleet_credential_2_vault_id;
  if (vault1 === null || vault2 === null) {
    log.warn({
      operation: "resolve",
      tenant_id: tenantId,
      error_code: "credentials_not_configured",
    });
    throw new CredentialError(
      `SuiteFleet credentials cannot be resolved for tenant ${tenantId}: credentials not configured for this merchant`,
    );
  }

  const [credential1, credential2] = await Promise.all([
    readVaultSecret(vault1),
    readVaultSecret(vault2),
  ]);

  const clientId = row.region_client_id;
  const authMethod = row.region_auth_method;

  log.debug({
    operation: "resolve",
    tenant_id: tenantId,
    auth_method: authMethod,
    source: "db",
  });

  if (authMethod === "oauth") {
    return {
      auth_method: "oauth",
      clientId,
      customerId,
      username: credential1,
      password: credential2,
    };
  }
  if (authMethod === "api_key") {
    return {
      auth_method: "api_key",
      clientId,
      customerId,
      apiKey: credential1,
      secretKey: credential2,
    };
  }

  // Defensive — CHECK constraint on suitefleet_regions.auth_method
  // (oauth | api_key) makes this branch unreachable. Surface as
  // CredentialError rather than letting an unexpected enum value silently
  // bypass the discriminator switch downstream.
  throw new CredentialError(
    `SuiteFleet credentials for tenant ${tenantId}: unknown region.auth_method '${authMethod}'`,
  );
}
