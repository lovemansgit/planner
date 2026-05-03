// SuiteFleet webhook credential resolver.
//
// Reads per-tenant webhook credentials from the
// `tenant_suitefleet_webhook_credentials` table seeded by the Day-8 /
// D8-2 schema migration. Returns null when no row exists for the
// tenant — this is a legitimate state (the merchant has not opted in
// to credential-based webhook verification) and the route handler
// gracefully degrades to Tier 1 (tenant-existence + payload-shape
// only) on a null return.
//
// Day-8 / D8-8 reshape: the original Day-4 implementation read shared
// sandbox env vars (SUITEFLEET_SANDBOX_WEBHOOK_CLIENT_ID/SECRET) and
// ignored the tenantId. P2 (3 May 2026) reversed the assumption that
// every merchant configures credentials — production merchants
// typically don't (memory/followup_d8_8_webhook_auth_model.md). The
// resolver now reads from the per-tenant table designed in D8-2 and
// returns null on absence.
//
// Logging: resolution emits a debug line with `tenant_id` + `source`
// only. Credential values never reach the logger; clientSecretHash is
// per-row data but the project logger redacts secret-like field names
// at the structured-logger layer as defence-in-depth.

import { sql as sqlTag } from "drizzle-orm";

import { logger } from "../../shared/logger";
import { withServiceRole } from "../../shared/db";
import type { Uuid } from "../../shared/types";

import type { SuiteFleetWebhookCredentials } from "./types";

const log = logger.with({ component: "suitefleet_webhook_credential_resolver" });

const RESOLVE_REASON = "webhook receiver: resolve creds";

/**
 * Look up the per-tenant SuiteFleet webhook credentials. Returns the
 * stored row when present (clientId plaintext + clientSecretHash bcrypt
 * hash). Returns null when the tenant has no row — a legitimate state
 * meaning the merchant has not configured credential-based verification.
 *
 * Throws on actual database errors (these surface as 500 in the route).
 *
 * Runs through `withServiceRole` because the webhook receiver has no
 * tenant context bound at the request layer (the receiver IS what
 * resolves the tenant). The `tenant_suitefleet_webhook_credentials`
 * RLS policy filters on `app.current_tenant_id`, which would
 * fail-closed under a `withTenant` wrapper. Service-role read is
 * appropriate because this code is the boundary that GRANTS tenant
 * context — credential lookup logically precedes per-tenant filtering.
 */
export async function resolveSuiteFleetWebhookCredentials(
  tenantId: Uuid,
): Promise<SuiteFleetWebhookCredentials | null> {
  const row = await withServiceRole(RESOLVE_REASON, async (tx) => {
    const result = await tx.execute<{
      client_id: string;
      client_secret_hash: string;
    }>(sqlTag`
      SELECT client_id, client_secret_hash
      FROM tenant_suitefleet_webhook_credentials
      WHERE tenant_id = ${tenantId}
      LIMIT 1
    `);
    const rows = result as unknown as ReadonlyArray<{
      client_id: string;
      client_secret_hash: string;
    }>;
    return rows.length > 0 ? rows[0] : null;
  });

  if (row === null) {
    log.debug({
      operation: "resolve",
      tenant_id: tenantId,
      outcome: "no_row",
    });
    return null;
  }

  log.debug({
    operation: "resolve",
    tenant_id: tenantId,
    outcome: "row_present",
  });

  return {
    clientId: row.client_id,
    clientSecretHash: row.client_secret_hash,
  };
}
