// SuiteFleet webhook credential resolver — Day 4 / S-4.
//
// Returns the per-tenant SuiteFleet WEBHOOK secret used to authenticate
// inbound webhook deliveries (X-Client-Id / X-Client-Secret headers).
// Separate from `resolveSuiteFleetCredentials`, which returns the
// OUTBOUND auth credentials (username/password/clientId/customerId).
//
// Day 4 reads from environment variables; Day 5+ swaps to AWS Secrets
// Manager at /transcorp/secrets/{tenantId}/suitefleet/webhook-credentials
// without changing this function's signature.
//
// `tenantId` is accepted on the Day-4 implementation but ignored: the
// same sandbox webhook secret authenticates every inbound delivery
// during pilot dev. Day 5+ introduces dynamic-route per-tenant URLs
// (`/api/webhooks/suitefleet/[tenantId]`) which feed real tenantIds
// into this resolver — at which point the env reads here become
// Secrets Manager lookups, again without touching the signature.
//
// Logging: resolution emits a debug line with `tenant_id` + `source`
// only. Credential values never reach the logger directly; the project
// logger redacts clientSecret / token / etc. at the field level as a
// defence-in-depth backstop.

import { CredentialError } from "../../shared/errors";
import { logger } from "../../shared/logger";
import type { Uuid } from "../../shared/types";

import type { SuiteFleetWebhookCredentials } from "./types";

const ENV_CLIENT_ID = "SUITEFLEET_SANDBOX_WEBHOOK_CLIENT_ID";
const ENV_CLIENT_SECRET = "SUITEFLEET_SANDBOX_WEBHOOK_CLIENT_SECRET";

const log = logger.with({ component: "suitefleet_webhook_credential_resolver" });

type EnvSource = Readonly<Record<string, string | undefined>>;

export async function resolveSuiteFleetWebhookCredentials(
  tenantId: Uuid,
  env: EnvSource = process.env,
): Promise<SuiteFleetWebhookCredentials> {
  // tenantId is intentionally unused in the Day-4 path — see file-header docblock.
  // TODO(Day-5): replace env reads with AWS Secrets Manager lookup at /transcorp/secrets/{tenantId}/suitefleet/webhook-credentials.
  const clientId = env[ENV_CLIENT_ID];
  const clientSecret = env[ENV_CLIENT_SECRET];

  const missing: string[] = [];
  if (!clientId) missing.push(ENV_CLIENT_ID);
  if (!clientSecret) missing.push(ENV_CLIENT_SECRET);

  if (missing.length > 0) {
    log.warn({
      operation: "resolve",
      tenant_id: tenantId,
      error_code: "missing_env_vars",
      missing_count: missing.length,
    });
    throw new CredentialError(
      `SuiteFleet webhook secrets missing from environment: ${missing.join(", ")}`,
    );
  }

  log.debug({
    operation: "resolve",
    tenant_id: tenantId,
    source: "env",
  });

  return {
    clientId: clientId as string,
    clientSecret: clientSecret as string,
  };
}
