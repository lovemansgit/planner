#!/usr/bin/env node
// scripts/probe-sf-bulk-cancel-shape.mjs
//
// Day 21 / Session A — companion to probe-sf-cancel-status-field.mjs.
//
// Q3 doc-verified the bulk endpoint shape — `PATCH /api/tasks/bulk/{ids}`
// with comma-separated AWB list — but the response shape is undocumented.
// Pick 2 stale CREATED tasks on meal-plan-scheduler, fire single bulk
// PATCH with `{ status: "CANCELED" }`, capture full response.  Output
// drives BulkCancelResult typing for LANE 2-3.
//
// Usage:
//   set -a && source .env.local && set +a
//   node scripts/probe-sf-bulk-cancel-shape.mjs --dry-run
//   node scripts/probe-sf-bulk-cancel-shape.mjs

import postgres from "postgres";

const SF_API_BASE = "https://api.suitefleet.com";
const TARGET_CUSTOMER_CODE = "588";
const TARGET_TENANT_SLUG = "meal-plan-scheduler";
const BULK_COUNT = 2;

function need(name) {
  const v = process.env[name];
  if (!v) { console.error(`Missing ${name}`); process.exit(1); }
  return v;
}

function nowIso() { return new Date().toISOString(); }

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const dbUrl = need("SUPABASE_DATABASE_URL");
  const username = need("SUITEFLEET_SANDBOX_USERNAME");
  const password = need("SUITEFLEET_SANDBOX_PASSWORD");
  const clientId = need("SUITEFLEET_SANDBOX_CLIENT_ID");

  console.log(`[${nowIso()}] step=start dry_run=${dryRun}`);

  const sql = postgres(dbUrl, { max: 1, prepare: false });

  const tenantRows = await sql`
    SELECT id FROM tenants
    WHERE suitefleet_customer_code = ${TARGET_CUSTOMER_CODE}
      AND slug = ${TARGET_TENANT_SLUG}
    LIMIT 1
  `;
  if (tenantRows.length === 0) { await sql.end(); process.exit(2); }
  const tenantId = tenantRows[0].id;

  const targets = await sql`
    SELECT id, external_id, external_tracking_number, delivery_date
    FROM tasks
    WHERE tenant_id = ${tenantId}
      AND internal_status = 'CREATED'
      AND external_id IS NOT NULL
      AND external_tracking_number IS NOT NULL
      AND pushed_to_external_at IS NOT NULL
      AND delivery_date < CURRENT_DATE
    ORDER BY delivery_date ASC
    LIMIT ${BULK_COUNT}
  `;
  if (targets.length < BULK_COUNT) {
    console.error(`Only ${targets.length} stale CREATED tasks available; need ${BULK_COUNT}`);
    await sql.end(); process.exit(3);
  }
  console.log(`[${nowIso()}] step=target_select count=${targets.length}`);
  for (const t of targets) {
    console.log(`  task_id=${t.id} awb=${t.external_tracking_number} sf_id=${t.external_id} delivery_date=${t.delivery_date.toISOString().slice(0,10)}`);
  }

  if (dryRun) { await sql.end(); return; }

  // Auth
  const authUrl = new URL(`${SF_API_BASE}/api/auth/authenticate`);
  authUrl.searchParams.set("username", username);
  authUrl.searchParams.set("password", password);
  const authRes = await fetch(authUrl, { method: "POST", headers: { Clientid: clientId, Accept: "application/json" } });
  if (!authRes.ok) { console.error(`auth failed: ${authRes.status}`); await sql.end(); process.exit(4); }
  const auth = await authRes.json();
  const token = auth.accessToken ?? auth.token ?? auth.access_token;
  console.log(`[${nowIso()}] step=auth ok`);

  const awbs = targets.map((t) => t.external_tracking_number);
  // Per Day-6 asset-tracking precedent + Q3 doc-verified: comma-separated AWBs in path.
  // Per SF readme, also try ?awbs= query convention if path-based 404s.
  const idsCsv = awbs.join(",");
  const url = `${SF_API_BASE}/api/tasks/bulk/${encodeURIComponent(idsCsv)}`;
  const probeStart = new Date();
  console.log(`[${nowIso()}] step=patch_bulk start url=${url}`);
  const start = Date.now();
  let response;
  try {
    response = await fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        Clientid: clientId,
        "Content-Type": "application/merge-patch+json",
        Accept: "application/json",
      },
      body: JSON.stringify({ status: "CANCELED" }),
    });
  } catch (err) {
    console.error(`network error: ${err.message}`); await sql.end(); process.exit(5);
  }
  const elapsedMs = Date.now() - start;
  const headers = {};
  for (const [k, v] of response.headers.entries()) headers[k] = v;
  const bodyText = await response.text();
  console.log(`  status=${response.status} ${response.statusText} elapsed_ms=${elapsedMs}`);
  console.log(`  request_url=${url}`);
  console.log(`  request_body={"status":"CANCELED"}`);
  console.log(`  response_headers=${JSON.stringify(headers, null, 2)}`);
  console.log(`  response_body=${bodyText}`);

  // Webhook poll — filter by AWB list per LANE-1 finding (column stores AWB).
  console.log(`[${nowIso()}] step=webhook_poll start`);
  const cutoff = Date.now() + 60_000;
  let observed = false;
  while (Date.now() < cutoff) {
    const events = await sql`
      SELECT id, suitefleet_task_id, action, event_timestamp, received_at
      FROM webhook_events
      WHERE tenant_id = ${tenantId}
        AND received_at >= ${probeStart}
        AND suitefleet_task_id = ANY(${awbs})
      ORDER BY received_at ASC
    `;
    if (events.length >= awbs.length) {
      observed = true;
      console.log(`  events_received=${events.length}`);
      for (const e of events) {
        console.log(`  ${e.received_at.toISOString()} awb=${e.suitefleet_task_id} action=${e.action}`);
      }
      break;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  if (!observed) {
    console.log(`  webhook_poll timeout (60s) — partial or no events received`);
  }

  console.log(`[${nowIso()}] step=task_local_state`);
  for (const t of targets) {
    const r = await sql`SELECT internal_status, updated_at FROM tasks WHERE id = ${t.id}`;
    console.log(`  ${t.external_tracking_number}: internal_status=${r[0].internal_status} updated_at=${r[0].updated_at.toISOString()}`);
  }

  await sql.end();
}

main().catch((e) => { console.error(e.stack ?? e.message); process.exit(99); });
