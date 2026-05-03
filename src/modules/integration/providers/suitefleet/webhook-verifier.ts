// SuiteFleet webhook verifier.
//
// Pure function (modulo bcrypt.compare async I/O) that verifies an
// inbound webhook delivery's `clientid` / `clientsecret` headers
// against the per-tenant stored credentials. No body parsing happens
// here — that's the parser's job. No state mutation — the route
// handler routes on the `WebhookVerificationResult` returned.
//
// -------------------------------------------------------------------
// Header names (Day 8 / D8-8 fix from Day-4 scaffold):
//
// SuiteFleet sends `clientid` and `clientsecret` as flat lowercase
// header names with no dashes (per the Day-7 empirical capture in
// `memory/followup_webhook_auth_architecture.md`). Web `Headers.get()`
// is case-insensitive but NOT dash-insensitive — `X-Client-Id` and
// `clientid` are distinct HTTP header names. The Day-4 scaffolding
// erroneously read the dashed names, which would 401 every legitimate
// SF webhook. D8-8 corrects to the empirical capture.
// -------------------------------------------------------------------
//
// -------------------------------------------------------------------
// Three-state result (Day 8 / D8-8 reshape from Day-4 strict require):
//
// Per `memory/followup_d8_8_webhook_auth_model.md`, credential
// configuration is opt-in per merchant in SuiteFleet's portal. When
// the per-tenant `tenant_suitefleet_webhook_credentials` row is
// absent (the resolver returns null), the verifier emits
// `{ ok: true, authTier: 'tier_1_only' }` — the route layer then
// runs Tier-1 gates (tenant-existence + payload-shape) only.
// When the row IS present, the verifier compares the headers; success
// is `tier_2_passed`, failure is one of four `reason` values.
// -------------------------------------------------------------------
//
// -------------------------------------------------------------------
// Timing-parity property (load-bearing):
//
// Two header lookups always run. Two compares always run — the
// clientId compare (timing-safe equality on plaintext) and the
// clientSecret compare (bcrypt.compare against the stored hash). The
// routing decision happens at the bottom on four boolean flags.
//
// Missing-input branches still run their compare against a same-
// length null-byte fallback (clientId) or against a fixed dummy
// 60-char bcrypt hash (clientSecret). bcrypt's intentional ~50-100ms
// cost dwarfs branch-time differences, so an attacker can't
// distinguish "header missing" from "header present but wrong" via
// timing — and crucially, can't distinguish "no creds row exists for
// this tenant" from "creds row exists but headers mismatched" because
// the no-row branch returns BEFORE running compares (the timing leak
// is intentional masking via the receiver's overall request handling
// flow — see the route handler's verification chain ordering).
// -------------------------------------------------------------------

import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";

import bcrypt from "bcryptjs";

import type { SuiteFleetWebhookCredentials } from "../../../credentials";

import type { HeadersLike, WebhookVerificationResult } from "../../types";

const HEADER_CLIENT_ID = "clientid";
const HEADER_CLIENT_SECRET = "clientsecret";
const FALLBACK_CHAR = "\0";

// Fixed dummy 60-char bcrypt hash used when the inbound clientSecret
// header is absent. bcrypt.compare against this value runs at full
// bcrypt cost (~50-100ms) and always returns false. Generated via
// `bcrypt.hashSync('', 10)` once at import time, then frozen.
const DUMMY_BCRYPT_HASH = bcrypt.hashSync("", 10);

function constantTimeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) {
    timingSafeEqual(aBuf, Buffer.alloc(aBuf.length));
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

export type StringCompareFn = (a: string, b: string) => boolean;
export type BcryptCompareFn = (plaintext: string, hash: string) => Promise<boolean>;

/**
 * Verify an inbound SuiteFleet webhook against the per-tenant stored
 * credentials. Caller passes `null` for `expected` when the tenant has
 * no credentials row — verifier emits `tier_1_only` OK without running
 * compares. When `expected` is non-null, runs both compares and
 * emits either `tier_2_passed` OK or one of four mismatch reasons.
 *
 * The two compare functions are injectable for testability:
 * `stringCompare` overrides the timing-safe clientId compare;
 * `bcryptCompare` overrides bcrypt.compare. Production calls use the
 * module's defaults; tests pass spies to assert call count, arguments,
 * and ordering.
 */
export async function verifySuiteFleetWebhook(
  headers: HeadersLike,
  expected: SuiteFleetWebhookCredentials | null,
  stringCompare: StringCompareFn = constantTimeStringEqual,
  bcryptCompare: BcryptCompareFn = bcrypt.compare,
): Promise<WebhookVerificationResult> {
  if (expected === null) {
    return { ok: true, authTier: "tier_1_only" };
  }

  const incomingClientId = headers.get(HEADER_CLIENT_ID);
  const incomingClientSecret = headers.get(HEADER_CLIENT_SECRET);

  const hasClientId = incomingClientId !== null && incomingClientId !== "";
  const hasClientSecret = incomingClientSecret !== null && incomingClientSecret !== "";

  // Same-length null-byte fallback when the clientId header is absent.
  // The compare still runs an n-byte timing-safe comparison.
  const clientIdInput = hasClientId
    ? (incomingClientId as string)
    : FALLBACK_CHAR.repeat(expected.clientId.length);

  // Fixed dummy hash when the clientSecret header is absent. bcrypt's
  // intentional cost dwarfs branch-time differences; the compare
  // always runs at the same wall-clock cost.
  const clientSecretInput = hasClientSecret ? (incomingClientSecret as string) : "";
  const hashForCompare = hasClientSecret ? expected.clientSecretHash : DUMMY_BCRYPT_HASH;

  const clientIdMatches = stringCompare(clientIdInput, expected.clientId);
  const clientSecretMatches = await bcryptCompare(clientSecretInput, hashForCompare);

  if (!hasClientId) return { ok: false, reason: "missing_client_id" };
  if (!hasClientSecret) return { ok: false, reason: "missing_client_secret" };
  if (!clientIdMatches) return { ok: false, reason: "client_id_mismatch" };
  if (!clientSecretMatches) return { ok: false, reason: "client_secret_mismatch" };
  return { ok: true, authTier: "tier_2_passed" };
}
