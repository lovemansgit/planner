#!/usr/bin/env node
// scripts/probe-sf-cancel-status-field.mjs
//
// Day 21 / Session A — Q2 sandbox probe.
//
// Determines the exact merge-patch field name SuiteFleet expects for
// the cancel path on PATCH /api/tasks/awb/{awb}.  Doc-verified ledger
// (memory/decision_phase_1_aqib_doc_verified.md Q2) confirms the
// endpoint shape but leaves the field name unresolved — `status:
// "CANCELED"` vs `internalStatus: "CANCEL"` vs other.  Adapter
// signature for cancelTask cannot lock until this resolves.
//
// Side effect: PATCHes a real SF sandbox task to CANCELED.  Pick a
// stale CREATED task on tenant 588 (customer.code MPL =
// meal-plan-scheduler) — delivery_date in the past, operationally
// orphaned.  Probe accepts --dry-run to print the candidate without
// firing the PATCH.
//
// Usage (from repo root, with .env.local sourced):
//   set -a && source .env.local && set +a
//   node scripts/probe-sf-cancel-status-field.mjs --dry-run
//   node scripts/probe-sf-cancel-status-field.mjs

import postgres from "postgres";

const SF_API_BASE = "https://api.suitefleet.com";
const TARGET_CUSTOMER_CODE = "588";
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

function nowIso() {
  return new Date().toISOString();
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has("--dry-run");

  const dbUrl = need("SUPABASE_DATABASE_URL");
  const username = need("SUITEFLEET_SANDBOX_USERNAME");
  const password = need("SUITEFLEET_SANDBOX_PASSWORD");
  const clientId = need("SUITEFLEET_SANDBOX_CLIENT_ID");

  console.log(`[${nowIso()}] step=start dry_run=${dryRun}`);

  const sql = postgres(dbUrl, { max: 1, prepare: false });

  // ---------------------------------------------------------------------------
  // Step 1: resolve tenant_id for customer_code=588 (MPL).
  // ---------------------------------------------------------------------------
  let tenantId;
  try {
    // Multiple tenants may share customer_code=588 (A1-resolver test fixtures).
    // Pin to the canonical meal-plan-scheduler slug per
    // memory/decision_phase_1_aqib_doc_verified.md Q2.
    const rows = await sql`
      SELECT id, slug, name, suitefleet_customer_code
      FROM tenants
      WHERE suitefleet_customer_code = ${TARGET_CUSTOMER_CODE}
        AND slug = ${TARGET_TENANT_SLUG}
      LIMIT 1
    `;
    if (rows.length === 0) {
      console.error(
        `No tenant with suitefleet_customer_code=${TARGET_CUSTOMER_CODE} AND slug=${TARGET_TENANT_SLUG}`,
      );
      await sql.end();
      process.exit(2);
    }
    tenantId = rows[0].id;
    console.log(
      `[${nowIso()}] step=tenant_resolve ok tenant_id=${tenantId} ` +
        `slug=${rows[0].slug} name="${rows[0].name}" customer_code=${rows[0].suitefleet_customer_code}`,
    );
  } catch (err) {
    console.error(`step=tenant_resolve failed: ${err.message}`);
    await sql.end();
    process.exit(2);
  }

  // ---------------------------------------------------------------------------
  // Step 2: pick the OLDEST stale CREATED task with external_id + AWB.
  // delivery_date in the past = operationally orphaned, safe to mutate.
  // ---------------------------------------------------------------------------
  let target;
  try {
    const rows = await sql`
      SELECT
        id,
        tenant_id,
        external_id,
        external_tracking_number,
        internal_status,
        delivery_date,
        customer_order_number,
        pushed_to_external_at
      FROM tasks
      WHERE tenant_id = ${tenantId}
        AND internal_status = 'CREATED'
        AND external_id IS NOT NULL
        AND external_tracking_number IS NOT NULL
        AND pushed_to_external_at IS NOT NULL
        AND delivery_date < CURRENT_DATE
      ORDER BY delivery_date ASC
      LIMIT 1
    `;
    if (rows.length === 0) {
      console.error(
        `No stale CREATED task on tenant ${tenantId} with delivery_date<today and SF push complete. ` +
          `Cannot probe safely without picking an in-flight task.`,
      );
      await sql.end();
      process.exit(3);
    }
    target = rows[0];
    console.log(`[${nowIso()}] step=target_select ok`);
    console.log(`  task_id=${target.id}`);
    console.log(`  external_id=${target.external_id}`);
    console.log(`  awb=${target.external_tracking_number}`);
    console.log(`  internal_status=${target.internal_status}`);
    console.log(`  delivery_date=${target.delivery_date.toISOString().slice(0, 10)}`);
    console.log(`  customer_order_number=${target.customer_order_number}`);
    console.log(`  pushed_to_external_at=${target.pushed_to_external_at.toISOString()}`);
  } catch (err) {
    console.error(`step=target_select failed: ${err.message}`);
    await sql.end();
    process.exit(3);
  }

  if (dryRun) {
    console.log(`[${nowIso()}] step=done dry_run no patch fired`);
    await sql.end();
    return;
  }

  // ---------------------------------------------------------------------------
  // Step 3: auth — POST /api/auth/authenticate.
  // ---------------------------------------------------------------------------
  console.log(`[${nowIso()}] step=auth start`);
  const authUrl = new URL(`${SF_API_BASE}/api/auth/authenticate`);
  authUrl.searchParams.set("username", username);
  authUrl.searchParams.set("password", password);
  const authRes = await fetch(authUrl, {
    method: "POST",
    headers: { Clientid: clientId, Accept: "application/json" },
  });
  if (!authRes.ok) {
    const txt = await authRes.text();
    console.error(`auth failed: status=${authRes.status} body=${txt.slice(0, 400)}`);
    await sql.end();
    process.exit(4);
  }
  const auth = await authRes.json();
  const token = auth.accessToken ?? auth.token ?? auth.access_token;
  if (!token) {
    console.error(`auth response missing token field; keys=${Object.keys(auth).join(",")}`);
    await sql.end();
    process.exit(5);
  }
  console.log(`[${nowIso()}] step=auth ok token_len=${token.length}`);

  // ---------------------------------------------------------------------------
  // Step 4: PATCH variant A — { status: "CANCELED" }.
  // ---------------------------------------------------------------------------
  const patchUrl = `${SF_API_BASE}/api/tasks/awb/${encodeURIComponent(target.external_tracking_number)}`;
  const probeStart = new Date();
  console.log(`[${nowIso()}] step=patch_variant_a start`);
  console.log(`  url=${patchUrl}`);
  const variantA = await fireProbe(patchUrl, token, clientId, { status: "CANCELED" });
  printProbeResult("variant_a", { status: "CANCELED" }, variantA);

  let chosen = null;
  if (variantA.ok) {
    chosen = "variant_a";
  } else if (variantA.status >= 400 && variantA.status < 500) {
    // ---------------------------------------------------------------------------
    // Step 5: PATCH variant B — { internalStatus: "CANCEL" }.
    // ---------------------------------------------------------------------------
    console.log(`[${nowIso()}] step=patch_variant_b start (variant_a 4xx)`);
    const variantB = await fireProbe(patchUrl, token, clientId, { internalStatus: "CANCEL" });
    printProbeResult("variant_b", { internalStatus: "CANCEL" }, variantB);
    if (variantB.ok) chosen = "variant_b";
    else {
      console.error(`Both variants rejected. Surface to reviewer; doc-vs-actual divergence likely.`);
    }
  } else {
    console.error(`variant_a returned 5xx or network error; not retrying with variant_b. Investigate.`);
  }

  // ---------------------------------------------------------------------------
  // Step 6: poll webhook_events for SF-side reflection.
  // ---------------------------------------------------------------------------
  if (chosen) {
    console.log(
      `[${nowIso()}] step=webhook_poll start chosen=${chosen} ` +
        `polling up to ${WEBHOOK_POLL_SECONDS}s for webhook arrival`,
    );
    const cutoff = Date.now() + WEBHOOK_POLL_SECONDS * 1000;
    let observed = false;
    while (Date.now() < cutoff) {
      const rows = await sql`
        SELECT id, action, event_timestamp, received_at, raw_payload
        FROM webhook_events
        WHERE tenant_id = ${tenantId}
          AND suitefleet_task_id = ${String(target.external_id)}
          AND received_at >= ${probeStart}
        ORDER BY received_at ASC
      `;
      if (rows.length > 0) {
        observed = true;
        console.log(`[${nowIso()}] step=webhook_poll observed count=${rows.length}`);
        for (const r of rows) {
          console.log(`  --- webhook_event ---`);
          console.log(`  id=${r.id}`);
          console.log(`  action=${r.action}`);
          console.log(`  event_timestamp=${r.event_timestamp.toISOString()}`);
          console.log(`  received_at=${r.received_at.toISOString()}`);
          console.log(`  raw_payload=${JSON.stringify(r.raw_payload, null, 2)}`);
        }
        break;
      }
      await new Promise((r) => setTimeout(r, WEBHOOK_POLL_INTERVAL_MS));
    }
    if (!observed) {
      console.log(
        `[${nowIso()}] step=webhook_poll timeout no webhook_events row matched ` +
          `tenant_id=${tenantId} suitefleet_task_id=${target.external_id} ` +
          `received_at>=${probeStart.toISOString()} within ${WEBHOOK_POLL_SECONDS}s`,
      );
    }
  }

  await sql.end();
  console.log(`[${nowIso()}] step=done chosen=${chosen ?? "none"}`);
}

async function fireProbe(url, token, clientId, body) {
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
      body: JSON.stringify(body),
    });
  } catch (err) {
    return {
      ok: false,
      networkError: true,
      message: err instanceof Error ? err.message : String(err),
      elapsedMs: Date.now() - start,
    };
  }
  const elapsedMs = Date.now() - start;
  const headers = {};
  for (const [k, v] of response.headers.entries()) headers[k] = v;
  let bodyText;
  try {
    bodyText = await response.text();
  } catch {
    bodyText = "";
  }
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    headers,
    bodyText,
    elapsedMs,
  };
}

function printProbeResult(label, requestBody, r) {
  if (r.networkError) {
    console.error(
      `  ${label}: NETWORK_ERROR elapsed_ms=${r.elapsedMs} message="${r.message}"`,
    );
    return;
  }
  console.log(`  ${label}: status=${r.status} ${r.statusText} elapsed_ms=${r.elapsedMs}`);
  console.log(`  request_body=${JSON.stringify(requestBody)}`);
  console.log(`  response_headers=${JSON.stringify(r.headers, null, 2)}`);
  console.log(`  response_body=${r.bodyText.length === 0 ? "(empty)" : r.bodyText}`);
}

main().catch((err) => {
  console.error(`UNCAUGHT: ${err.stack ?? err.message ?? String(err)}`);
  process.exit(99);
});
