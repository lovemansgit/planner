#!/usr/bin/env node
// scripts/probe-sf-asset-tracking-report.mjs
//
// Day 55 / Session B — BAG TRACKING report plan lane.
//
// Read-only probe of GET /api/task-asset-tracking against sandbox
// merchant 588 with the Client-Credentials auth we hold. Three
// questions, all read-only:
//   1. Does the endpoint answer to our standard Bearer + Clientid
//      auth (vs requiring a user-JWT)?
//   2. Verbatim response shape for a single AWB — ideally one with
//      real asset records now that UAT runs have created tasks.
//   3. Batch behaviour: comma-separated `awbs=` (vendor question 4,
//      previously unverified).
//
// Usage:
//   set -a && source .env.local && set +a
//   node scripts/probe-sf-asset-tracking-report.mjs

import postgres from "postgres";

const SF_API_BASE = "https://api.suitefleet.com";
const TARGET_CUSTOMER_CODE = "588";

function need(name) {
  const v = process.env[name];
  if (!v) { console.error(`Missing ${name}`); process.exit(1); }
  return v;
}

function nowIso() { return new Date().toISOString(); }

async function sfGet(token, clientId, path) {
  const res = await fetch(`${SF_API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Clientid: clientId,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text.slice(0, 2000); }
  return { status: res.status, body };
}

async function main() {
  const dbUrl = need("SUPABASE_DATABASE_URL");
  const username = need("SUITEFLEET_SANDBOX_USERNAME");
  const password = need("SUITEFLEET_SANDBOX_PASSWORD");
  const clientId = need("SUITEFLEET_SANDBOX_CLIENT_ID");

  console.log(`[${nowIso()}] step=start`);

  const sql = postgres(dbUrl, { max: 1, prepare: false });

  // Candidate AWBs: most-recent tasks that completed the SF round
  // trip, newest first, mixed statuses (DELIVERED most likely to
  // carry asset records).
  const candidates = await sql`
    SELECT t.external_tracking_number AS awb,
           t.internal_status,
           t.delivery_date
    FROM tasks t
    JOIN tenants ten ON ten.id = t.tenant_id
    WHERE ten.suitefleet_customer_code = ${TARGET_CUSTOMER_CODE}
      AND t.external_tracking_number IS NOT NULL
    ORDER BY t.delivery_date DESC
    LIMIT 12
  `;
  await sql.end();

  console.log(`[${nowIso()}] step=candidates count=${candidates.length}`);
  for (const c of candidates) {
    console.log(`  awb=${c.awb} status=${c.internal_status} date=${c.delivery_date.toISOString().slice(0, 10)}`);
  }
  if (candidates.length === 0) { console.error("no AWBs to probe"); process.exit(2); }

  // Auth — standard client-credentials flow (same as /api/tasks).
  const authUrl = new URL(`${SF_API_BASE}/api/auth/authenticate`);
  authUrl.searchParams.set("username", username);
  authUrl.searchParams.set("password", password);
  const authRes = await fetch(authUrl, {
    method: "POST",
    headers: { Clientid: clientId, Accept: "application/json" },
  });
  if (!authRes.ok) {
    console.error(`auth failed: ${authRes.status}`);
    process.exit(3);
  }
  const auth = await authRes.json();
  const token = auth.accessToken ?? auth.token ?? auth.access_token;
  if (!token) { console.error("auth response carried no access token"); process.exit(3); }
  console.log(`[${nowIso()}] step=auth ok=true`);

  // Probe 1: single AWB, walk newest-first until one returns records
  // (or we exhaust the list — that itself is a finding).
  let firstNonEmpty = null;
  for (const c of candidates) {
    const r = await sfGet(token, clientId, `/api/task-asset-tracking?awbs=${encodeURIComponent(c.awb)}`);
    const n = r.body?.totalElements ?? "n/a";
    console.log(`[${nowIso()}] probe=single awb=${c.awb} status=${r.status} totalElements=${n}`);
    if (r.status !== 200) {
      console.log(`  VERBATIM: ${JSON.stringify(r.body)}`);
      break; // auth-shape finding — stop hammering
    }
    if (r.body?.content?.length > 0 && firstNonEmpty === null) {
      firstNonEmpty = { awb: c.awb, body: r.body };
    }
    await new Promise((res) => setTimeout(res, 250)); // stay under throttle
  }

  if (firstNonEmpty) {
    console.log(`[${nowIso()}] step=single_verbatim awb=${firstNonEmpty.awb}`);
    console.log(JSON.stringify(firstNonEmpty.body, null, 2));
  } else {
    console.log(`[${nowIso()}] step=single_verbatim result=ALL_EMPTY — emit one empty wrapper verbatim:`);
    const r = await sfGet(token, clientId, `/api/task-asset-tracking?awbs=${encodeURIComponent(candidates[0].awb)}`);
    console.log(JSON.stringify(r.body, null, 2));
  }

  // Probe 2: batch — comma-separated, first 3 candidates.
  const batch = candidates.slice(0, 3).map((c) => c.awb).join(",");
  const rBatch = await sfGet(token, clientId, `/api/task-asset-tracking?awbs=${encodeURIComponent(batch)}`);
  console.log(`[${nowIso()}] probe=batch awbs=${batch} status=${rBatch.status}`);
  console.log(JSON.stringify(rBatch.body, null, 2));

  console.log(`[${nowIso()}] step=done`);
}

main().catch((e) => { console.error(e); process.exit(99); });
