// SuiteFleet credential resolver — Day 4 / S-3.
//
// Returns the per-tenant SuiteFleet secret. Day 4 reads from environment
// variables; Day 5+ swaps to AWS Secrets Manager at the path
//   /transcorp/secrets/{tenantId}/suitefleet/credentials
// without changing this function's signature.
//
// `tenantId` is accepted on the Day-4 implementation but ignored: the
// same sandbox secret serves every tenant during pilot dev. The
// signature is the contract that holds across the env→Secrets-Manager
// swap, which is why it's `Promise<...>` rather than synchronous —
// Secrets Manager calls are network-bound, env reads are not, but
// callers must already be `await`-aware.
//
// Logging: resolution emits a debug line with `tenant_id` + `source`
// only. Credential values never reach the logger directly; the project
// logger redacts password / username / clientSecret / token / etc. at
// the field level as a defence-in-depth backstop.

import { CredentialError } from "../../shared/errors";
import { logger } from "../../shared/logger";
import type { Uuid } from "../../shared/types";

import type { SuiteFleetCredentials } from "./types";

const ENV_USERNAME = "SUITEFLEET_SANDBOX_USERNAME";
const ENV_PASSWORD = "SUITEFLEET_SANDBOX_PASSWORD";
const ENV_CLIENT_ID = "SUITEFLEET_SANDBOX_CLIENT_ID";
const ENV_CUSTOMER_ID = "SUITEFLEET_SANDBOX_CUSTOMER_ID";

const log = logger.with({ component: "suitefleet_credential_resolver" });

type EnvSource = Readonly<Record<string, string | undefined>>;

export async function resolveSuiteFleetCredentials(
  tenantId: Uuid,
  env: EnvSource = process.env,
): Promise<SuiteFleetCredentials> {
  // tenantId is intentionally unused in the Day-4 path — see file-header docblock.
  // TODO(Day-5): replace env reads with AWS Secrets Manager lookup at /transcorp/secrets/{tenantId}/suitefleet/credentials.
  const username = env[ENV_USERNAME];
  const password = env[ENV_PASSWORD];
  const clientId = env[ENV_CLIENT_ID];
  const customerIdRaw = env[ENV_CUSTOMER_ID];

  const missing: string[] = [];
  if (!username) missing.push(ENV_USERNAME);
  if (!password) missing.push(ENV_PASSWORD);
  if (!clientId) missing.push(ENV_CLIENT_ID);
  if (!customerIdRaw) missing.push(ENV_CUSTOMER_ID);

  if (missing.length > 0) {
    log.warn({
      operation: "resolve",
      tenant_id: tenantId,
      error_code: "missing_env_vars",
      missing_count: missing.length,
    });
    throw new CredentialError(
      `SuiteFleet sandbox credentials missing from environment: ${missing.join(", ")}`,
    );
  }

  const customerId = Number.parseInt(customerIdRaw as string, 10);
  if (!Number.isInteger(customerId) || customerId <= 0) {
    log.warn({
      operation: "resolve",
      tenant_id: tenantId,
      error_code: "customer_id_invalid",
    });
    throw new CredentialError(
      `${ENV_CUSTOMER_ID} must be a positive integer; got an unparseable value`,
    );
  }

  log.debug({
    operation: "resolve",
    tenant_id: tenantId,
    source: "env",
  });

  return {
    username: username as string,
    password: password as string,
    clientId: clientId as string,
    customerId,
  };
}
