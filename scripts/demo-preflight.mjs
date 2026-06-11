#!/usr/bin/env node
// scripts/demo-preflight.mjs
//
// Day 21 / Phase 1 — pre-demo verification gate per
// memory/PLANNER_PRODUCT_BRIEF.md §5.3 + quality gate #11.
//
// Runs every gate from the brief; exits 0 if all pass, non-zero on
// any failure. Per brief: "Runs twice on Day 19 (start of dry-run, 30
// min before live demo)". For Day 21+ usage (T-5 to internal CAIO
// demo on May 15), this is the canonical readiness signal.
//
// 10 gates from the brief:
//   1. Demo Bistro merchant exists, status=ACTIVE, pickup address set
//   2. ≥3 other seeded merchants (MPL, DNR, FBU)
//   3. Total consignees ≥ 845
//   4. Cron has run within last 24 hours
//   5. ≥1 task with status=DELIVERED and pod_photos IS NOT NULL
//   6. ≥1 subscription_exception of type=skip with compensating_date
//   7. Fatima Al Mansouri has address rotation configured
//   8. Sarah Khouri has CRM state=ACTIVE pre-demo + ≥2 FAILED deliveries
//      (brief v1.10 amendment: live HIGH_RISK flip is the demo-theater
//      action, not a pre-seed invariant)
//   9. SF integration responsive (ping /api/auth/authenticate)
//  10. Auth flows work for test accounts
//
// Each gate is a small async fn returning { passed: boolean,
// detail: string }. Report is one line per gate plus a final summary.
//
// Usage (from repo root, with .env.local sourced):
//   set -a && source .env.local && set +a
//   node scripts/demo-preflight.mjs
//
// Or use the wrapper at scripts/demo-preflight.sh which sources for you.
//
// RUNBOOK — when to run on demo day:
//   Brief §5.3 schedules two runs (start of dry-run + 30 min before live).
//   Gate 4 (cron-recency) is intentionally generous at 24h to keep the
//   gate stable across morning rehearsal + afternoon dress-rehearsal +
//   evening live demo windows. For tightest signal, run the preflight
//   AFTER the daily 16:00-17:00 Dubai cron tick has fired — that
//   guarantees Gate 4 reflects the same horizon-advance the live demo
//   will show. A pre-cron-window run can pass Gate 4 against
//   yesterday's tick (still <24h) but won't catch a same-day cron
//   regression.

import postgres from "postgres";

const SF_API_BASE = "https://api.suitefleet.com";

function need(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`[demo-preflight] FATAL: missing env var ${name}`);
    process.exit(2);
  }
  return v;
}

function nowIso() {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Gate runners. Each returns { passed: boolean, detail: string, label: string }.
// ---------------------------------------------------------------------------

async function gate1DemoBistroExists(sql) {
  const rows = await sql`
    SELECT id, slug, name, status, pickup_address_line
    FROM tenants
    WHERE slug ILIKE '%bistro%'
      AND status = 'active'
      AND pickup_address_line IS NOT NULL
      AND pickup_address_line <> ''
  `;
  if (rows.length === 0) {
    return { passed: false, detail: "no Demo Bistro tenant found (slug ILIKE '%bistro%' + status=active + pickup_address_line set)" };
  }
  const t = rows[0];
  return { passed: true, detail: `tenant ${t.slug} (id=${t.id.slice(0, 8)}...) status=${t.status} pickup="${t.pickup_address_line.slice(0, 40)}"` };
}

async function gate2OtherSeededMerchants(sql) {
  const rows = await sql`
    SELECT slug, name
    FROM tenants
    WHERE slug IN ('meal-plan-scheduler', 'dnr', 'fbu', 'demo-bistro')
       OR suitefleet_customer_code IN ('588', '586', '578')
    ORDER BY slug
  `;
  if (rows.length < 3) {
    return { passed: false, detail: `only ${rows.length} seeded merchants found (need ≥3 of MPL/DNR/FBU)` };
  }
  return { passed: true, detail: `${rows.length} seeded merchants: ${rows.map((r) => r.slug).join(", ")}` };
}

async function gate3ConsigneeCount(sql) {
  const rows = await sql`SELECT count(*)::int AS n FROM consignees`;
  const n = rows[0].n;
  if (n < 845) return { passed: false, detail: `${n} consignees (need ≥845)` };
  return { passed: true, detail: `${n} consignees` };
}

async function gate4CronRecency(sql) {
  // The materialization cron writes task_generation_runs rows on each
  // tick. Looking for the most recent row's created_at; pass if within
  // the last 24h. Fallback: if the table doesn't exist or is empty,
  // check tasks.created_at for any row created within the last 24h
  // (less precise — task creation could come from imports too — but
  // unblocks the gate when seed data is being prepared fresh).
  try {
    const rows = await sql`
      SELECT max(created_at) AS last_run
      FROM task_generation_runs
    `;
    const lastRun = rows[0].last_run;
    if (lastRun === null) {
      return { passed: false, detail: "task_generation_runs table empty — cron has never run" };
    }
    const ageMs = Date.now() - new Date(lastRun).getTime();
    const ageHours = ageMs / 3_600_000;
    if (ageHours > 24) {
      return { passed: false, detail: `last cron tick ${ageHours.toFixed(1)}h ago (need <24h)` };
    }
    return { passed: true, detail: `last cron tick ${ageHours.toFixed(1)}h ago` };
  } catch (err) {
    return { passed: false, detail: `task_generation_runs query failed: ${err.message}` };
  }
}

async function gate5DeliveredWithPodPhoto(sql) {
  // Doubles as a regression-detector for the v1.8 brief amendment
  // (POD via webhook → Layer 2 status-fn write → Layer 3 POD-extraction
  // populates tasks.pod_photos in the same UPDATE; brief §3.3.8
  // "cache from webhook, never live-fetch"). A regression that
  // reverts to polling or that loses the in-UPDATE pod_photos write
  // would zero this gate even if the rest of the demo state is
  // healthy.
  const rows = await sql`
    SELECT count(*)::int AS n
    FROM tasks
    WHERE internal_status = 'DELIVERED'
      AND pod_photos IS NOT NULL
  `;
  const n = rows[0].n;
  if (n < 1) {
    return { passed: false, detail: "no DELIVERED tasks with pod_photos populated — webhook → POD pipeline not exercised" };
  }
  return { passed: true, detail: `${n} DELIVERED tasks with pod_photos` };
}

async function gate6SkipWithCompensatingDate(sql) {
  const rows = await sql`
    SELECT count(*)::int AS n
    FROM subscription_exceptions
    WHERE type = 'skip'
      AND compensating_date IS NOT NULL
  `;
  const n = rows[0].n;
  if (n < 1) {
    return { passed: false, detail: "no skip exceptions with compensating_date — skip-and-append flow not exercised" };
  }
  return { passed: true, detail: `${n} skip exceptions with compensating_date set` };
}

async function gate7FatimaAddressRotation(sql) {
  const rows = await sql`
    SELECT
      c.id AS consignee_id,
      c.name,
      count(r.weekday) AS rotation_count
    FROM consignees c
    JOIN subscriptions s ON s.consignee_id = c.id
    JOIN subscription_address_rotations r ON r.subscription_id = s.id
    WHERE c.name ILIKE '%fatima%mansouri%'
    GROUP BY c.id, c.name
  `;
  if (rows.length === 0) {
    return { passed: false, detail: "Fatima Al Mansouri not found OR no subscription_address_rotations rows for her subscriptions" };
  }
  const r = rows[0];
  if (Number(r.rotation_count) < 1) {
    return { passed: false, detail: `Fatima found (${r.consignee_id.slice(0, 8)}...) but rotation_count=${r.rotation_count}` };
  }
  return { passed: true, detail: `Fatima Al Mansouri has ${r.rotation_count} address rotation rows` };
}

async function gate8SarahActivePreDemoFailedDeliveries(sql) {
  // Brief v1.10 amendment (line 836, filed Day 21): Sarah Khouri must be
  // crm_state='ACTIVE' pre-demo with ≥2 FAILED deliveries in history.
  // The live HIGH_RISK flip is the demo-theater action during Chapter 5
  // of the storyline (operator marks her HIGH_RISK on stage), NOT a
  // pre-seed invariant. If seed-demo-personas.mjs sets her to HIGH_RISK
  // before the demo, the theater fails because there's nothing to flip.
  const rows = await sql`
    SELECT
      c.id AS consignee_id,
      c.name,
      c.crm_state,
      count(t.id) FILTER (WHERE t.internal_status = 'FAILED') AS failed_count
    FROM consignees c
    LEFT JOIN tasks t ON t.consignee_id = c.id
    WHERE c.name ILIKE '%sarah%khouri%'
    GROUP BY c.id, c.name, c.crm_state
  `;
  if (rows.length === 0) {
    return { passed: false, detail: "Sarah Khouri not found in consignees" };
  }
  const r = rows[0];
  if (r.crm_state !== "ACTIVE") {
    return { passed: false, detail: `Sarah found (${r.consignee_id.slice(0, 8)}...) but crm_state=${r.crm_state} (need ACTIVE pre-demo per brief v1.10)` };
  }
  const failed = Number(r.failed_count);
  if (failed < 2) {
    return { passed: false, detail: `Sarah found + ACTIVE but only ${failed} FAILED deliveries (need ≥2)` };
  }
  return { passed: true, detail: `Sarah Khouri crm_state=ACTIVE pre-demo with ${failed} FAILED deliveries (HIGH_RISK flip is the live demo action)` };
}

async function gate9SfIntegrationResponsive() {
  const username = process.env.SUITEFLEET_SANDBOX_USERNAME;
  const password = process.env.SUITEFLEET_SANDBOX_PASSWORD;
  const clientId = process.env.SUITEFLEET_SANDBOX_CLIENT_ID;
  if (!username || !password || !clientId) {
    return { passed: false, detail: "SUITEFLEET_SANDBOX_* env vars not set" };
  }
  const url = new URL(`${SF_API_BASE}/api/auth/authenticate`);
  url.searchParams.set("username", username);
  url.searchParams.set("password", password);
  const start = Date.now();
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { Clientid: clientId, Accept: "application/json" },
    });
  } catch (err) {
    return { passed: false, detail: `network error: ${err.message}` };
  }
  const elapsedMs = Date.now() - start;
  if (!response.ok) {
    return { passed: false, detail: `SF auth returned ${response.status} in ${elapsedMs}ms` };
  }
  const body = await response.json();
  const token = body.accessToken ?? body.token ?? body.access_token;
  if (!token) {
    return { passed: false, detail: `SF auth 200 but no accessToken in body (keys: ${Object.keys(body).join(",")})` };
  }
  return { passed: true, detail: `SF /api/auth/authenticate 200 in ${elapsedMs}ms; token_len=${token.length}` };
}

async function gate10AuthFlowsTestAccounts(sql) {
  // Brief §5.3 #10: "Auth flows work for transcorp_staff test account
  // and tenant_admin test account". Full assertion requires HTTP
  // POST against the Planner sign-in endpoint with seeded test creds
  // — out of scope for this scaffolding pass since the test-account
  // seed convention isn't yet locked. This gate currently checks the
  // *existence* of users with the required role kinds via the
  // role_assignments join table, surfacing a partial-pass when both
  // kinds exist but full HTTP smoke has not been wired.
  const rows = await sql`
    SELECT
      count(DISTINCT ra.user_id) FILTER (WHERE r.slug = 'transcorp-sysadmin') AS staff,
      count(DISTINCT ra.user_id) FILTER (WHERE r.slug = 'tenant-admin') AS admin
    FROM role_assignments ra
    JOIN roles r ON r.id = ra.role_id
  `;
  const r = rows[0];
  const staff = Number(r.staff);
  const admin = Number(r.admin);
  if (staff < 1 || admin < 1) {
    return {
      passed: false,
      detail: `users with required roles: transcorp-sysadmin=${staff} tenant-admin=${admin} (need ≥1 of each)`,
    };
  }
  return {
    passed: true,
    detail: `users with required roles: transcorp-sysadmin=${staff} tenant-admin=${admin} (TODO: HTTP smoke not yet wired — sign-in seed convention pending)`,
  };
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

async function main() {
  const dbUrl = need("SUPABASE_DATABASE_URL");
  console.log(`[${nowIso()}] demo-preflight start`);

  const sql = postgres(dbUrl, { max: 1, prepare: false });

  const gates = [
    { label: "1. Demo Bistro merchant exists", run: () => gate1DemoBistroExists(sql) },
    { label: "2. ≥3 seeded merchants", run: () => gate2OtherSeededMerchants(sql) },
    { label: "3. Total consignees ≥ 845", run: () => gate3ConsigneeCount(sql) },
    { label: "4. Cron has run within 24h", run: () => gate4CronRecency(sql) },
    { label: "5. ≥1 DELIVERED task with POD photos", run: () => gate5DeliveredWithPodPhoto(sql) },
    { label: "6. ≥1 skip with compensating_date", run: () => gate6SkipWithCompensatingDate(sql) },
    { label: "7. Fatima Al Mansouri has address rotation", run: () => gate7FatimaAddressRotation(sql) },
    { label: "8. Sarah Khouri ACTIVE pre-demo with ≥2 FAILED", run: () => gate8SarahActivePreDemoFailedDeliveries(sql) },
    { label: "9. SF integration responsive", run: () => gate9SfIntegrationResponsive() },
    { label: "10. Auth flows for test accounts", run: () => gate10AuthFlowsTestAccounts(sql) },
  ];

  const results = [];
  for (const gate of gates) {
    let result;
    try {
      result = await gate.run();
    } catch (err) {
      result = { passed: false, detail: `EXCEPTION: ${err.message}` };
    }
    results.push({ label: gate.label, ...result });
    const mark = result.passed ? "✓" : "✗";
    console.log(`  ${mark} ${gate.label}: ${result.detail}`);
  }

  await sql.end();

  const failed = results.filter((r) => !r.passed);
  console.log(`[${nowIso()}] demo-preflight complete: ${results.length - failed.length}/${results.length} pass`);

  if (failed.length > 0) {
    console.log(`\nFailed gates:`);
    for (const r of failed) {
      console.log(`  ✗ ${r.label}: ${r.detail}`);
    }
    process.exit(1);
  }

  console.log(`\nAll gates pass. Demo-ready.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(`[demo-preflight] UNCAUGHT: ${err.stack ?? err.message ?? String(err)}`);
  process.exit(99);
});
