// Supabase Vault wrapper — Day 26 / per-merchant SF credentials lane.
//
// Thin auth-method-agnostic wrapper over Postgres `vault.create_secret`
// + `vault.update_secret` + `SELECT decrypted_secret FROM
// vault.decrypted_secrets`. The wrapper does NOT know about
// `auth_method` (oauth/api_key) or the credential semantics —
// semantic interpretation lives in the caller (resolver + credentials
// service).
//
// Service-role only: every call runs inside `withServiceRole` because
// the `vault.decrypted_secrets` view is restricted by Supabase RLS to
// service-role callers. planner_app cannot read or write Vault
// directly.
//
// Plaintext-handling rules (load-bearing, per brief §3.7 + plan §3.3):
//   - Plaintext NEVER stored outside Vault. The tenants row stores
//     only the UUID.
//   - Plaintext NEVER appears in audit_events.metadata. Caller is
//     responsible; this wrapper only takes plaintext on the write path
//     and returns it on the read path.
//   - Plaintext NEVER logged. This module passes nothing into the
//     logger.
//   - Plaintext NEVER returned to the UI. Read access is intended for
//     the resolver's authenticated-call codepath only (login() →
//     discarded after).
//
// Failure modes: missing Vault rows (READ) surface as a NotFoundError
// from the caller path (the resolver detects null UUIDs upstream and
// fails closed there; this module only sees a non-null UUID input).
// Vault availability is a deployment-time precondition (verified pre-
// merge per plan §3.1) and not checked at runtime.

import { sql as sqlTag } from "drizzle-orm";

import { withServiceRole } from "../../shared/db";
import { NotFoundError } from "../../shared/errors";

const REASON_CREATE = "credentials: vault create_secret";
const REASON_UPDATE = "credentials: vault update_secret";
const REASON_READ = "credentials: vault read_secret";

/**
 * Insert a new Vault secret with the given plaintext. Returns the
 * generated UUID that the caller stores on the tenant row.
 *
 * The plaintext is passed to `vault.create_secret(secret)`; Vault
 * encrypts at rest (pgsodium AEAD) and returns the row identifier.
 *
 * Never logs the plaintext.
 */
export async function createVaultSecret(plaintext: string): Promise<string> {
  return withServiceRole(REASON_CREATE, async (tx) => {
    type Row = { id: string } & Record<string, unknown>;
    const rows = await tx.execute<Row>(sqlTag`
      SELECT vault.create_secret(${plaintext}) AS id
    `);
    const result = rows as unknown as ReadonlyArray<Row>;
    if (result.length === 0 || typeof result[0].id !== "string") {
      throw new Error("vault.create_secret returned no id");
    }
    return result[0].id;
  });
}

/**
 * Rotate an existing Vault secret in place. The UUID is preserved;
 * only the plaintext is replaced. Used by the rotation path of
 * `storeSuitefleetCredentials` so the tenant row's Vault UUID never
 * changes — operationally important because rotation should not
 * cascade into a foreign-key column rewrite.
 *
 * Throws NotFoundError if no Vault row matches the supplied UUID. The
 * caller's invariants (tenant row carries a non-null Vault UUID iff
 * credentials are provisioned) make this branch unreachable in
 * practice; defensive for any operator-introduced inconsistency.
 */
export async function updateVaultSecret(id: string, plaintext: string): Promise<void> {
  await withServiceRole(REASON_UPDATE, async (tx) => {
    type Row = { id: string } & Record<string, unknown>;
    // vault.update_secret(secret_id, new_secret) returns void; emulate
    // a presence check via a follow-on SELECT so we can surface a
    // NotFoundError rather than silently no-op on a stale UUID.
    await tx.execute(sqlTag`SELECT vault.update_secret(${id}::uuid, ${plaintext})`);
    const rows = await tx.execute<Row>(sqlTag`
      SELECT id FROM vault.secrets WHERE id = ${id}::uuid
    `);
    const result = rows as unknown as ReadonlyArray<Row>;
    if (result.length === 0) {
      throw new NotFoundError(`vault secret not found: ${id}`);
    }
  });
}

/**
 * Read the decrypted plaintext for a Vault row by UUID. Used by the
 * resolver's authenticated-call codepath only — the plaintext flows
 * straight into auth-client `login()` and is discarded immediately
 * after the SF call completes. Never returned to UI surfaces.
 *
 * Throws NotFoundError if no Vault row matches the supplied UUID.
 */
export async function readVaultSecret(id: string): Promise<string> {
  return withServiceRole(REASON_READ, async (tx) => {
    type Row = { decrypted_secret: string } & Record<string, unknown>;
    const rows = await tx.execute<Row>(sqlTag`
      SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id = ${id}::uuid
    `);
    const result = rows as unknown as ReadonlyArray<Row>;
    if (result.length === 0) {
      throw new NotFoundError(`vault secret not found: ${id}`);
    }
    return result[0].decrypted_secret;
  });
}
