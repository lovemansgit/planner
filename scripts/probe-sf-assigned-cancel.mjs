#!/usr/bin/env node
// scripts/probe-sf-assigned-cancel.mjs
//
// Day-54 / Session C — R-E load-bearing probe (dispatch step 3).
//
// Question: does SuiteFleet ACCEPT or REJECT a customer-API cancel
// (PATCH /api/tasks/awb/{awb} {status:"CANCELED"} — the sanctioned
// route locked by the Day-21 Q2 probe) on a task that is already in
// DRIVER HANDS? R-E's churn cascade must recall assigned deliveries;
// the honesty rule's "vendor refused recall" branch is real only if
// SF can refuse.
//
// Precondition gap, stated up front: a strict ASSIGNED-state task
// cannot be manufactured from a builder seat — the customer API has
// no assignment surface (verified: no assignment endpoint in
// wire-types/task-client/doc-verified ledger) and no MPL task
// currently sits in ASSIGNED (all 6 historical TASK_HAS_BEEN_ASSIGNED
// tasks progressed onward). Closest sanctioned probe: the one
// IN_TRANSIT task — driver-bound, ONE STAGE PAST assigned,
// past-dated (operationally orphaned, same safety standard as the
// Q2 probe's target selection).
//
// Usage:
//   set -a && source .env.local && set +a
//   node scripts/probe-sf-assigned-cancel.mjs --dry-run   # print target only
//   node scripts/probe-sf-assigned-cancel.mjs

import postgres from "postgres";

const SF_API_BASE = "https://api.suitefleet.com";
const TARGET_AWB = "MPL-11182722"; // the orphaned IN_TRANSIT task (external_id 61135, delivery 2026-05-21)
const TARGET_TENANT_SLUG = "meal-plan-scheduler";
const WEBHOOK_POLL_SECONDS = 60;
const WEBHOOK_POLL_INTERVAL_MS = 5000;

function need(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing env var: ${name}`);
    process.exit(1);
  }
  return v;
}

const nowIso = () => new Date().toISOString();

async function sfGetActivities(awb, token, clientId, customerId) {
  const url = `${SF_API_BASE}/api/tasks/awb/${encodeURIComponent(awb)}/task-activities?customerId=${encodeURIComponent(customerId)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Clientid: clientId, Accept: "application/json" },
  });
  const text = await res.text();
  return { status: res.status, body: text };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const dbUrl = need("SUPABASE_DATABASE_URL");
  const username = need("SUITEFLEET_SANDBOX_USERNAME");
  const password = need("SUITEFLEET_SANDBOX_PASSWORD");
  const clientId = need("SUITEFLEET_SANDBOX_CLIENT_ID");
  const customerId = need("SUITEFLEET_SANDBOX_CUSTOMER_ID");

  console.log(`[${nowIso()}] step=start dry_run=${dryRun} target_awb=${TARGET_AWB}`);
  const sql = postgres(dbUrl, { max: 1, prepare: false });

  // Step 1 — local before-state.
  const rows = await sql`
    SELECT t.id, t.tenant_id, t.external_id, t.external_tracking_number,
           t.internal_status, t.delivery_date, t.outbound_sync_state
    FROM tasks t JOIN tenants ten ON ten.id = t.tenant_id
    WHERE ten.slug = ${TARGET_TENANT_SLUG}
      AND t.external_tracking_number = ${TARGET_AWB}
    LIMIT 1
  `;
  if (rows.length === 0) {
    console.error(`target AWB ${TARGET_AWB} not found locally`);
    await sql.end();
    process.exit(2);
  }
  const target = rows[0];
  console.log(`[${nowIso()}] step=local_before ok`);
  console.log(`  task_id=${target.id} external_id=${target.external_id}`);
  console.log(`  internal_status=${target.internal_status} outbound_sync_state=${target.outbound_sync_state}`);
  console.log(`  delivery_date=${target.delivery_date.toISOString().slice(0, 10)}`);

  if (dryRun) {
    console.log(`[${nowIso()}] step=done dry_run — no auth, no PATCH`);
    await sql.end();
    return;
  }

  // Step 2 — auth.
  const authUrl = new URL(`${SF_API_BASE}/api/auth/authenticate`);
  authUrl.searchParams.set("username", username);
  authUrl.searchParams.set("password", password);
  const authRes = await fetch(authUrl, {
    method: "POST",
    headers: { Clientid: clientId, Accept: "application/json" },
  });
  if (!authRes.ok) {
    console.error(`auth failed: status=${authRes.status}`);
    await sql.end();
    process.exit(4);
  }
  const auth = await authRes.json();
  const token = auth.accessToken ?? auth.token ?? auth.access_token;
  console.log(`[${nowIso()}] step=auth ok token_len=${token.length}`);

  // Step 3 — SF-side before-state (task-activities; last activity = current stage).
  const before = await sfGetActivities(TARGET_AWB, token, clientId, customerId);
  console.log(`[${nowIso()}] step=sf_before status=${before.status}`);
  console.log(`  body=${before.body.slice(0, 1500)}`);

  // Step 4 — THE PROBE: sanctioned cancel route, verbatim shape.
  const probeStart = new Date();
  const patchUrl = `${SF_API_BASE}/api/tasks/awb/${encodeURIComponent(TARGET_AWB)}`;
  console.log(`[${nowIso()}] step=cancel_patch start url=${patchUrl} body={"status":"CANCELED"}`);
  const patchRes = await fetch(patchUrl, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      Clientid: clientId,
      "Content-Type": "application/merge-patch+json",
      Accept: "application/json",
    },
    body: JSON.stringify({ status: "CANCELED" }),
  });
  const patchText = await patchRes.text();
  console.log(`[${nowIso()}] step=cancel_patch done`);
  console.log(`  http_status=${patchRes.status}`);
  console.log(`  response_body=${patchText.slice(0, 2000)}`);

  // Step 5 — SF-side after-state.
  const after = await sfGetActivities(TARGET_AWB, token, clientId, customerId);
  console.log(`[${nowIso()}] step=sf_after status=${after.status}`);
  console.log(`  body=${after.body.slice(0, 1500)}`);

  // Step 6 — webhook reflection poll.
  console.log(`[${nowIso()}] step=webhook_poll start (${WEBHOOK_POLL_SECONDS}s)`);
  const cutoff = Date.now() + WEBHOOK_POLL_SECONDS * 1000;
  let observed = false;
  while (Date.now() < cutoff) {
    const events = await sql`
      SELECT action, event_timestamp, received_at
      FROM webhook_events
      WHERE suitefleet_task_id = ${TARGET_AWB}
        AND received_at >= ${probeStart}
      ORDER BY received_at ASC
    `;
    if (events.length > 0) {
      observed = true;
      for (const e of events) {
        console.log(
          `  webhook: action=${e.action} event_ts=${e.event_timestamp.toISOString()} received=${e.received_at.toISOString()}`,
        );
      }
      break;
    }
    await new Promise((r) => setTimeout(r, WEBHOOK_POLL_INTERVAL_MS));
  }
  if (!observed) console.log(`[${nowIso()}] step=webhook_poll timeout — no rows in ${WEBHOOK_POLL_SECONDS}s`);

  // Step 7 — local after-state.
  const localAfter = await sql`
    SELECT internal_status, outbound_sync_state FROM tasks WHERE id = ${target.id}
  `;
  console.log(
    `[${nowIso()}] step=local_after internal_status=${localAfter[0].internal_status} outbound_sync_state=${localAfter[0].outbound_sync_state}`,
  );

  await sql.end();
  console.log(`[${nowIso()}] step=done`);
}

main().catch((err) => {
  console.error(`probe crashed: ${err.message}`);
  process.exit(99);
});
