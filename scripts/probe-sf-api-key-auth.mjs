#!/usr/bin/env node
// scripts/probe-sf-api-key-auth.mjs
//
// Day-52 / Session A — API-key auth-header empirical gate.
//
// HARD MERGE GATE for branch fix/d36-a-api-key-auth-header. Aqib's reply
// gives the api_key auth shape as POST /api/auth/authenticate with headers
// clientId + clientApiKey + clientSecretKey (30d access / 180d refresh).
// That shape matched NEITHER candidate in
// memory/followup_aqib_api_key_auth_header_pending.md, so per the
// bulk-cancel-AWB precedent (a doc-verified shape empirically refuted on
// Day-21) it must be probed against a LIVE api_key-region endpoint before
// merge. See memory/decision_aqib_api_key_auth_header_verified.md.
//
// IMPORTANT — there is NO sandbox api_key endpoint: the sandbox region
// (transcorpsb) is OAuth-only. This probe needs PRODUCTION-region api_key
// credentials (transcorp / transcorpuae / transcorpqatar via SF OpsPortal)
// AND explicit production-probe authorization. It will NOT run against the
// OAuth sandbox.
//
// Secret hygiene: the request api_key/secret and the response tokens are
// REDACTED in output. The probe's job is to confirm header NAMES/casing,
// the HTTP status, and the token-body field shape — none of which require
// leaking live secrets or tokens into the report/transcript.
//
// Usage:
//   export SUITEFLEET_APIKEY_CLIENT_ID=...
//   export SUITEFLEET_APIKEY_API_KEY=...
//   export SUITEFLEET_APIKEY_SECRET_KEY=...
//   # optional: export SF_API_BASE=https://api.suitefleet.com
//   node scripts/probe-sf-api-key-auth.mjs --dry-run   # print request shape, no call
//   node scripts/probe-sf-api-key-auth.mjs             # live call

const SF_API_BASE = process.env.SF_API_BASE ?? "https://api.suitefleet.com";

function need(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name}`);
    process.exit(1);
  }
  return v;
}

function nowIso() {
  return new Date().toISOString();
}

function redact(v) {
  if (!v) return "<empty>";
  return `<redacted len=${String(v).length}>`;
}

function redactBody(text) {
  // Mask token values; keep structural fields, expirations, and error text.
  try {
    const o = JSON.parse(text);
    for (const k of [
      "accessToken",
      "refreshToken",
      "token",
      "access_token",
      "refresh_token",
    ]) {
      if (k in o) o[k] = "<redacted>";
    }
    return JSON.stringify(o, null, 2);
  } catch {
    return text; // non-JSON (HTML error pages etc.) — show as-is
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const clientId = need("SUITEFLEET_APIKEY_CLIENT_ID");
  const apiKey = need("SUITEFLEET_APIKEY_API_KEY");
  const secretKey = need("SUITEFLEET_APIKEY_SECRET_KEY");

  const url = `${SF_API_BASE}/api/auth/authenticate`;
  const headerNames = ["clientId", "clientApiKey", "clientSecretKey", "Accept"];

  console.log(`[${nowIso()}] step=start dry_run=${dryRun} base=${SF_API_BASE}`);
  console.log(`  request_method=POST`);
  console.log(`  request_url=${url}`);
  console.log(`  request_header_names=${JSON.stringify(headerNames)}`);
  console.log(
    `  request_headers(redacted)=${JSON.stringify(
      {
        clientId,
        clientApiKey: redact(apiKey),
        clientSecretKey: redact(secretKey),
        Accept: "application/json",
      },
      null,
      2,
    )}`,
  );
  console.log(`  request_body=<none — credentials in headers, NOT query string or body>`);

  if (dryRun) {
    console.log(`[${nowIso()}] step=dry_run_complete (no live call)`);
    return;
  }

  const start = Date.now();
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        clientId,
        clientApiKey: apiKey,
        clientSecretKey: secretKey,
        Accept: "application/json",
      },
    });
  } catch (err) {
    console.error(`network error: ${err.message}`);
    process.exit(5);
  }
  const elapsedMs = Date.now() - start;
  const headers = {};
  for (const [k, v] of response.headers.entries()) headers[k] = v;
  const bodyText = await response.text();

  console.log(`[${nowIso()}] step=auth_response`);
  console.log(`  status=${response.status} ${response.statusText} elapsed_ms=${elapsedMs}`);
  console.log(`  response_headers=${JSON.stringify(headers, null, 2)}`);
  console.log(`  response_body(tokens redacted)=${redactBody(bodyText)}`);

  // Verdict hints for the §3.6 #2 reviewer.
  if (response.status === 200) {
    console.log(
      `  VERDICT_HINT=header shape ACCEPTED (200). Confirm token body carries accessToken / refreshToken / accessTokenExpiration / refreshTokenExpiration.`,
    );
  } else if (response.status === 401 || response.status === 403) {
    console.log(
      `  VERDICT_HINT=auth rejected (${response.status}) — header NAMES may be right but creds invalid, OR the header shape is wrong. Compare against candidate (a)/(b) in the pending memo.`,
    );
  } else if (response.status >= 500) {
    console.log(
      `  VERDICT_HINT=server ${response.status} — header shape likely malformed (cf. the bulk-cancel 500 NumberFormat precedent).`,
    );
  } else {
    console.log(`  VERDICT_HINT=unexpected ${response.status} — inspect body.`);
  }

  // ---------------------------------------------------------------------------
  // Day-53 — refresh-wire observation (plan
  // memory/plans/day-53-sf-apikey-production-auth-lane.md §3).
  //
  // The OAuth refresh wire (GET /api/auth/refresh + Cookie: refreshToken
  // + Clientid header) is UNVERIFIED for api_key tokens — the decision
  // memo's Q4 residual. After a successful api_key login, attempt that
  // wire with the returned refresh token and RECORD the outcome. This
  // step never fails the probe: it is observation, not a gate. If it
  // returns 200 with a token body, the token-cache skip-refresh strategy
  // can be revisited with evidence.
  // ---------------------------------------------------------------------------
  if (response.status === 200) {
    let refreshToken;
    try {
      refreshToken = JSON.parse(bodyText).refreshToken;
    } catch {
      refreshToken = undefined;
    }
    if (typeof refreshToken !== "string" || refreshToken.length === 0) {
      console.log(`[${nowIso()}] step=refresh_observation SKIPPED — no refreshToken in login body`);
      return;
    }
    const refreshUrl = `${SF_API_BASE}/api/auth/refresh`;
    console.log(`[${nowIso()}] step=refresh_observation`);
    console.log(`  request=GET ${refreshUrl}`);
    console.log(`  request_headers=Clientid + Cookie: refreshToken=<redacted> (the OAuth wire, observed for api_key)`);
    try {
      const rStart = Date.now();
      const rResponse = await fetch(refreshUrl, {
        method: "GET",
        headers: {
          Clientid: clientId,
          Cookie: `refreshToken=${refreshToken}`,
          Accept: "application/json",
        },
      });
      const rBody = await rResponse.text();
      console.log(`  status=${rResponse.status} ${rResponse.statusText} elapsed_ms=${Date.now() - rStart}`);
      console.log(`  response_body(tokens redacted)=${redactBody(rBody)}`);
      if (rResponse.status === 200) {
        console.log(`  REFRESH_OBSERVATION=OAuth wire WORKS for api_key tokens — Q4 closes; skip-refresh strategy may be revisited (one-line revert with this evidence).`);
      } else {
        console.log(`  REFRESH_OBSERVATION=OAuth wire REJECTED for api_key tokens (${rResponse.status}) — Q4 closes the other way; skip-refresh strategy stands.`);
      }
    } catch (err) {
      console.log(`  REFRESH_OBSERVATION=network error during observation: ${err.message} — inconclusive, probe verdict unaffected.`);
    }
  }
}

main().catch((e) => {
  console.error(e.stack ?? e.message);
  process.exit(99);
});
