// SuiteFleet credential resolver — A1 swap (Day 18 / 8 May 2026).
//
// Returns the per-tenant SuiteFleet secret. Region credentials
// (username / password / clientId) read from environment — these are
// region-scoped per memory/followup_per_tenant_merchant_id_routing.md
// §1 (transcorpsb sandbox; transcorpuae and transcorpqatar future).
// All merchants within a region share the region's env-backed credentials.
//
// `customerId` is the per-merchant numeric routing identifier
// (588 MPL / 586 DNR / 578 FBU in sandbox). Read from
// `tenants.suitefleet_customer_code` keyed by `tenantId`. Mirrors the
// suitefleet-webhook-resolver.ts house style: `withServiceRole` +
// `sqlTag` parameterised SELECT.
//
// Behavior on missing customer_code (Option A — locked by plan §2.2):
//   - tenant row not found            → CredentialError (tenant_not_found)
//   - customer_code NULL/empty/blank  → CredentialError (missing_customer_code)
//   - customer_code non-numeric/zero/negative → CredentialError (invalid_customer_code)
//
// Defense-in-depth, three layers (intentional, see
// memory/followup_a1_plan_section_2_5_premise_correction.md):
//   1. β cron filter at enumeration: list-cron-eligible-tenants.ts:80
//      excludes tenants where suitefleet_customer_code IS NULL OR ''
//   2. Per-task guard at task-push/service.ts:364-394 catches the race
//      window where customer_code was cleared between β enumeration and
//      queue-worker pickup
//   3. This resolver throws at adapter.authenticate time — fail-loud for
//      direct probe scripts, future non-cron callers, or any state where
//      both guards above failed
//
// Logging: resolution emits a debug line with `tenant_id` + `source`
// only. Credential values never reach the logger directly; the project
// logger redacts password / username / clientSecret / token / etc. at
// the field level as defence-in-depth.

import { sql as sqlTag } from "drizzle-orm";

import { withServiceRole } from "../../shared/db";
import { CredentialError } from "../../shared/errors";
import { logger } from "../../shared/logger";
import type { Uuid } from "../../shared/types";

import type { SuiteFleetCredentials } from "./types";

const ENV_USERNAME = "SUITEFLEET_SANDBOX_USERNAME";
const ENV_PASSWORD = "SUITEFLEET_SANDBOX_PASSWORD";
const ENV_CLIENT_ID = "SUITEFLEET_SANDBOX_CLIENT_ID";

const RESOLVE_REASON = "credentials: resolve suitefleet";

const log = logger.with({ component: "suitefleet_credential_resolver" });

// Strict positive-integer regex: no leading zeros, no sign, no decimals.
// Rejects "0", "0588", "-5", "5.5", "5abc", "E2E-RUN_ID", etc.
// Canonical sandbox values 588 / 586 / 578 all match.
const POSITIVE_INTEGER_RE = /^[1-9]\d*$/;

export async function resolveSuiteFleetCredentials(
  tenantId: Uuid,
): Promise<SuiteFleetCredentials> {
  // -----------------------------------------------------------------------
  // Region credentials — env-backed, shared across all merchants in region.
  // -----------------------------------------------------------------------
  const username = process.env[ENV_USERNAME];
  const password = process.env[ENV_PASSWORD];
  const clientId = process.env[ENV_CLIENT_ID];

  const missing: string[] = [];
  if (!username) missing.push(ENV_USERNAME);
  if (!password) missing.push(ENV_PASSWORD);
  if (!clientId) missing.push(ENV_CLIENT_ID);

  if (missing.length > 0) {
    log.warn({
      operation: "resolve",
      tenant_id: tenantId,
      error_code: "missing_env_vars",
      missing_count: missing.length,
    });
    throw new CredentialError(
      `SuiteFleet region credentials missing from environment: ${missing.join(", ")}`,
    );
  }

  // -----------------------------------------------------------------------
  // Per-merchant customerId — DB-backed via tenants.suitefleet_customer_code.
  // -----------------------------------------------------------------------
  const row = await withServiceRole(RESOLVE_REASON, async (tx) => {
    type Row = { suitefleet_customer_code: string | null } & Record<string, unknown>;
    const result = await tx.execute<Row>(sqlTag`
      SELECT suitefleet_customer_code
      FROM tenants
      WHERE id = ${tenantId}
      LIMIT 1
    `);
    const rows = result as unknown as ReadonlyArray<Row>;
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

  const raw = row.suitefleet_customer_code?.trim();
  if (!raw) {
    log.warn({
      operation: "resolve",
      tenant_id: tenantId,
      error_code: "missing_customer_code",
    });
    throw new CredentialError(
      `SuiteFleet credentials cannot be resolved for tenant ${tenantId}: suitefleet_customer_code is missing or empty`,
    );
  }

  if (!POSITIVE_INTEGER_RE.test(raw)) {
    log.warn({
      operation: "resolve",
      tenant_id: tenantId,
      error_code: "invalid_customer_code",
    });
    throw new CredentialError(
      `SuiteFleet credentials for tenant ${tenantId}: suitefleet_customer_code must be a positive integer`,
    );
  }

  const customerId = Number.parseInt(raw, 10);

  log.debug({
    operation: "resolve",
    tenant_id: tenantId,
    source: "db",
  });

  return {
    username: username as string,
    password: password as string,
    clientId: clientId as string,
    customerId,
  };
}
