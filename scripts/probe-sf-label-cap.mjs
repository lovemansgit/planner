#!/usr/bin/env node
// scripts/probe-sf-label-cap.mjs
//
// Day 17 / Session B — pre-flight probe: does SF /generate-label
// accept a 500-task comma-separated taskId list in one call?
//
// If 200 + valid PDF → path (a): raise cap to 500 (matches max page size).
// If 4xx/5xx        → path (b): keep cap at 100, surface UI warning.
//
// Prints status + content-type + body byte count + first 400 chars of
// a non-PDF body for diagnosis. NEVER prints the constructed URL
// (carries token + clientId per memory/followup_suitefleet_label_endpoint.md).
//
// Usage (from repo root, with .env.local sourced):
//   set -a && source .env.local && set +a
//   node scripts/probe-sf-label-cap.mjs

import postgres from "postgres";

const SF_API_BASE = "https://api.suitefleet.com";
const SF_LABEL_BASE = "https://shipment-label.suitefleet.com";

function need(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing env var: ${name}`);
    process.exit(1);
  }
  return v;
}

async function main() {
  // Admin URL bypasses RLS — needed because the probe runs without a
  // tenant session GUC. Counts/ids only; no mutation.
  const dbUrl = need("SUPABASE_DATABASE_URL");
  const username = need("SUITEFLEET_SANDBOX_USERNAME");
  const password = need("SUITEFLEET_SANDBOX_PASSWORD");
  const clientId = need("SUITEFLEET_SANDBOX_CLIENT_ID");

  // ---------------------------------------------------------------------------
  // Step 1: pull external_ids from a single tenant.
  // ---------------------------------------------------------------------------
  // Picking a single tenant — SF labels are tenant-scoped via the
  // bearer token; mixing tenants on one call would conflate the cap
  // probe with cross-tenant rejection.
  console.log(`[${new Date().toISOString()}] step=db-query start`);
  const sql = postgres(dbUrl, { max: 1, prepare: false });
  let externalIds = [];
  try {
    const rows = await sql`
      SELECT external_id FROM tasks
      WHERE external_id IS NOT NULL
        AND pushed_to_external_at IS NOT NULL
      LIMIT 500
    `;
    externalIds = rows.map((r) => r.external_id);
  } finally {
    await sql.end();
  }
  console.log(
    `[${new Date().toISOString()}] step=db-query ok available=${externalIds.length}`,
  );

  if (externalIds.length === 0) {
    console.error("No SF-pushed tasks in DB — cannot probe.");
    process.exit(2);
  }

  // ---------------------------------------------------------------------------
  // Step 2: auth against SF sandbox to get a fresh bearer token.
  // ---------------------------------------------------------------------------
  console.log(`[${new Date().toISOString()}] step=auth start`);
  const authUrl = new URL(`${SF_API_BASE}/api/auth/authenticate`);
  authUrl.searchParams.set("username", username);
  authUrl.searchParams.set("password", password);
  const authRes = await fetch(authUrl, {
    method: "POST",
    headers: { Clientid: clientId, Accept: "application/json" },
  });
  if (!authRes.ok) {
    console.error(`auth failed: status=${authRes.status}`);
    const txt = await authRes.text();
    console.error(`response (first 400): ${txt.slice(0, 400)}`);
    process.exit(3);
  }
  const auth = await authRes.json();
  const token = auth.accessToken ?? auth.token ?? auth.access_token;
  if (!token) {
    console.error("auth response missing token field");
    console.error(`keys=${Object.keys(auth).join(",")}`);
    process.exit(4);
  }
  console.log(
    `[${new Date().toISOString()}] step=auth ok ` +
      `access_expires_at=${auth.accessTokenExpiration ?? "unknown"}`,
  );

  // ---------------------------------------------------------------------------
  // Step 3: probe the label endpoint at the largest available count
  // up to 500.
  // ---------------------------------------------------------------------------
  const probeCount = Math.min(externalIds.length, 500);
  const idsForProbe = externalIds.slice(0, probeCount);

  const params = new URLSearchParams({
    taskId: idsForProbe.join(","),
    type: "indv-small",
    tz_offset: "4",
    token,
    clientId,
  });
  const probeUrl = `${SF_LABEL_BASE}/generate-label?${params.toString()}`;

  // CRITICAL: log only host + counts; NEVER log probeUrl (token-in-query).
  const urlByteSize = Buffer.byteLength(probeUrl, "utf8");
  console.log(
    `[${new Date().toISOString()}] step=probe start ` +
      `host=${new URL(probeUrl).host} task_count=${probeCount} ` +
      `url_bytes=${urlByteSize}`,
  );

  const start = Date.now();
  let res;
  try {
    res = await fetch(probeUrl, { method: "GET" });
  } catch (err) {
    console.error(
      `[${new Date().toISOString()}] step=probe network_error ` +
        `message="${err.message}"`,
    );
    process.exit(5);
  }
  const elapsedMs = Date.now() - start;

  const contentType = res.headers.get("content-type") ?? "(none)";
  const arrayBuffer = await res.arrayBuffer();
  const bytes = arrayBuffer.byteLength;

  console.log(
    `[${new Date().toISOString()}] step=probe done ` +
      `status=${res.status} elapsed_ms=${elapsedMs} ` +
      `content_type="${contentType}" bytes=${bytes}`,
  );

  // PDF magic header: %PDF
  const buf = Buffer.from(arrayBuffer);
  const looksLikePdf = bytes >= 4 && buf.slice(0, 4).toString("ascii") === "%PDF";

  if (res.ok && looksLikePdf) {
    console.log(
      `[${new Date().toISOString()}] result=SUCCESS pdf_magic=ok ` +
        `task_count=${probeCount}`,
    );
    console.log(`PROBE_DECISION=path-a (raise cap to ${probeCount})`);
    return;
  }

  if (!res.ok) {
    // Capture diagnostic body excerpt for non-success.
    const excerpt = buf.toString("utf8").slice(0, 400);
    console.error(
      `[${new Date().toISOString()}] result=REJECT status=${res.status} ` +
        `body_excerpt="${excerpt.replace(/\s+/g, " ")}"`,
    );
    console.log(`PROBE_DECISION=path-b (keep cap at 100)`);
    return;
  }

  // 200 but body is not a PDF — surface for diagnosis.
  const excerpt = buf.toString("utf8").slice(0, 400);
  console.error(
    `[${new Date().toISOString()}] result=AMBIGUOUS status=200 not_pdf ` +
      `body_excerpt="${excerpt.replace(/\s+/g, " ")}"`,
  );
  console.log(`PROBE_DECISION=path-b (keep cap at 100; SF body unexpected)`);
}

main().catch((err) => {
  console.error(`UNCAUGHT: ${err.stack ?? err.message ?? String(err)}`);
  process.exit(99);
});
