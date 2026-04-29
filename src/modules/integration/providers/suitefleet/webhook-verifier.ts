// SuiteFleet webhook verifier — Day 4 / S-4.
//
// Pure function that verifies an inbound webhook delivery's
// X-Client-Id / X-Client-Secret headers against the per-tenant
// expected values. No body parsing happens here — that's S-5's job.
// No state mutation — the route handler routes on the
// `WebhookVerificationResult` returned.
//
// Constant-time compare via `crypto.timingSafeEqual`. Wrong client_id
// and wrong client_secret take roughly equal time, so an attacker
// can't iterate over candidate client_ids while the secret is wrong
// and use a fast-fail timing oracle.
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

function constantTimeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) {
    // Run a dummy compare so the length-mismatch branch takes
    // similar time to the length-match branch. Not perfect (JIT may
    // optimise it away in principle) but hardens against the trivial
    // early-return timing oracle without measurable runtime cost.
    timingSafeEqual(aBuf, Buffer.alloc(aBuf.length));
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

export function verifySuiteFleetWebhook(
  headers: HeadersLike,
  expected: SuiteFleetWebhookCredentials,
): WebhookVerificationResult {
  const incomingClientId = headers.get(HEADER_CLIENT_ID);
  if (incomingClientId === null || incomingClientId === "") {
    return { ok: false, reason: "missing_client_id" };
  }

  const incomingClientSecret = headers.get(HEADER_CLIENT_SECRET);
  if (incomingClientSecret === null || incomingClientSecret === "") {
    return { ok: false, reason: "missing_client_secret" };
  }

  // Both compares always run when both headers are present, so the
  // routing decision below doesn't leak which check failed via timing.
  const clientIdMatches = constantTimeStringEqual(incomingClientId, expected.clientId);
  const clientSecretMatches = constantTimeStringEqual(
    incomingClientSecret,
    expected.clientSecret,
  );

  if (!clientIdMatches) {
    return { ok: false, reason: "client_id_mismatch" };
  }
  if (!clientSecretMatches) {
    return { ok: false, reason: "client_secret_mismatch" };
  }
  return { ok: true };
}
