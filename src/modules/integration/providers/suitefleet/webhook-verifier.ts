// SuiteFleet webhook verifier — Day 4 / S-4.
//
// Pure function that verifies an inbound webhook delivery's
// X-Client-Id / X-Client-Secret headers against the per-tenant
// expected values. No body parsing happens here — that's S-5's job.
// No state mutation — the route handler routes on the
// `WebhookVerificationResult` returned.
//
// -------------------------------------------------------------------
// Timing-parity property (load-bearing):
//
// Two header lookups always run. Two timing-safe compares always run.
// The routing decision happens at the bottom on four boolean flags
// (hasClientId, hasClientSecret, clientIdMatches, clientSecretMatches).
//
// When a header is missing, the compare on its side runs against a
// same-length null-byte fallback derived from the expected value.
// This makes the missing-header branch take roughly the same time as
// a wrong-value branch with the correct length: a probing attacker
// timing the response can't distinguish "X-Client-Id missing" from
// "X-Client-Secret missing", and the missing-header branches are
// observably similar to wrong-value branches.
//
// The `reason` field on the result still differentiates the four
// failure modes for server-internal logging — it isn't exposed in
// the 401 response body sent to the caller.
// -------------------------------------------------------------------
//
// Brief §10:
//   - On mismatch: 401, no further processing, no audit emit.
//     Not auditing unauthenticated probes is deliberate — auditing
//     every probe lets an attacker DDoS the audit table.
//
// Brief §5 confirms the wire shape (camel-cased per SuiteFleet docs):
//   - `X-Client-Id` and `X-Client-Secret` headers
//   - No HMAC signing (known gap)

import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";

import type { SuiteFleetWebhookCredentials } from "../../../credentials";

import type { HeadersLike, WebhookVerificationResult } from "../../types";

const HEADER_CLIENT_ID = "X-Client-Id";
const HEADER_CLIENT_SECRET = "X-Client-Secret";
const FALLBACK_CHAR = "\0";

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

export function verifySuiteFleetWebhook(
  headers: HeadersLike,
  expected: SuiteFleetWebhookCredentials,
  // Optional: overrides the timing-safe compare for testability.
  // Production calls use the module's constantTimeStringEqual; tests
  // pass a spy to assert call count + arguments.
  compare: StringCompareFn = constantTimeStringEqual,
): WebhookVerificationResult {
  const incomingClientId = headers.get(HEADER_CLIENT_ID);
  const incomingClientSecret = headers.get(HEADER_CLIENT_SECRET);

  const hasClientId = incomingClientId !== null && incomingClientId !== "";
  const hasClientSecret = incomingClientSecret !== null && incomingClientSecret !== "";

  // Same-length null-byte fallback when a header is absent. The compare
  // still runs an n-byte timing-safe comparison — same shape and
  // duration as a wrong-value submission of the correct length.
  const clientIdInput = hasClientId
    ? (incomingClientId as string)
    : FALLBACK_CHAR.repeat(expected.clientId.length);
  const clientSecretInput = hasClientSecret
    ? (incomingClientSecret as string)
    : FALLBACK_CHAR.repeat(expected.clientSecret.length);

  const clientIdMatches = compare(clientIdInput, expected.clientId);
  const clientSecretMatches = compare(clientSecretInput, expected.clientSecret);

  // Routing on four flags happens after both compares have completed.
  // Order of checks below determines which `reason` is reported when
  // multiple flags are false; observable timing across all four
  // failure cases is dominated by the two compares above, not by
  // these branch tests.
  if (!hasClientId) return { ok: false, reason: "missing_client_id" };
  if (!hasClientSecret) return { ok: false, reason: "missing_client_secret" };
  if (!clientIdMatches) return { ok: false, reason: "client_id_mismatch" };
  if (!clientSecretMatches) return { ok: false, reason: "client_secret_mismatch" };
  return { ok: true };
}
