#!/usr/bin/env node
// scripts/verify-demo-seed.mjs
//
// Day 24 — narrow smoke verifier for the 5 demo-state invariants that
// load-bear the May 15 internal CAIO walk-through. Sibling to
// `scripts/demo-preflight.mjs` (broader 10-gate readiness gate); this
// verifier targets only the data-side invariants Love lists in the
// Day-24 AM brief.
//
// Five assertions:
//   1. Demo Bistro tenant exists with suitefleet_customer_code
//      populated (non-null, non-empty). Proves the live-created
//      Demo Bistro tenant landed cleanly during dry-run setup.
//   2. Fatima Al Mansouri consignee exists with ≥2 addresses
//      (Home + Office) and per-weekday rotation rule rows present.
//      Proves brief §5.2 Q9-Q10 address-rotation storyline data.
//   3. Sarah Khouri consignee exists at crm_state='ACTIVE' (NOT
//      HIGH_RISK pre-demo per brief v1.10/v1.11) with ≥2 tasks in
//      status='FAILED' across the last 14 days. Proves the demo-
//      theater pre-condition: live HIGH_RISK flip is the on-stage
//      action, not a pre-seed invariant.
//   4. AWB MPL-64596425 present on tasks.external_id. Proves the
//      SF push pipeline produced real data end-to-end during the
//      Day-23 SF push verification probe.
//   5. tasks table has ≥1 row with pod_photos IS NOT NULL. Proves
//      the inbound webhook → POD-extraction path landed real data
//      (brief §5.3 Gate 5).
//
// Output: one PASS/FAIL line per assertion, plus a summary tail.
// Exits 0 if all pass, non-zero if any fail.
//
// Read-only against production DATABASE_URL (well, SUPABASE_DATABASE_URL
// to match the existing demo-preflight env convention).
//
// Usage (from repo root):
//   set -a && source .env.local && set +a
//   node scripts/verify-demo-seed.mjs

import postgres from "postgres";

const AWB_DEMO_FIXTURE = "MPL-64596425";

function need(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`[verify-demo-seed] FATAL: missing env var ${name}`);
    process.exit(2);
  }
  return v;
}

function nowIso() {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Assertions. Each returns { passed: boolean, detail: string }.
// ---------------------------------------------------------------------------

async function assertDemoBistroWithCustomerCode(sql) {
  const rows = await sql`
    SELECT id, slug, name, status, suitefleet_customer_code
    FROM tenants
    WHERE slug ILIKE '%bistro%'
  `;
  if (rows.length === 0) {
    return { passed: false, detail: "no Demo Bistro tenant found (slug ILIKE '%bistro%')" };
  }
  const t = rows[0];
  const code = t.suitefleet_customer_code;
  if (code === null || code === "") {
    return {
      passed: false,
      detail: `Demo Bistro tenant ${t.slug} found (id=${t.id.slice(0, 8)}...) but suitefleet_customer_code is ${code === null ? "NULL" : "empty"}`,
    };
  }
  return {
    passed: true,
    detail: `tenant ${t.slug} (id=${t.id.slice(0, 8)}...) suitefleet_customer_code=${code} status=${t.status}`,
  };
}

async function assertFatimaAddressesAndRotation(sql) {
  const rows = await sql`
    SELECT
      c.id            AS consignee_id,
      c.name,
      count(DISTINCT a.id)               AS address_count,
      count(DISTINCT r.weekday)          AS rotation_count
    FROM consignees c
    LEFT JOIN addresses a
      ON a.consignee_id = c.id
    LEFT JOIN subscriptions s
      ON s.consignee_id = c.id
    LEFT JOIN subscription_address_rotations r
      ON r.subscription_id = s.id
    WHERE c.name ILIKE '%fatima%mansouri%'
    GROUP BY c.id, c.name
  `;
  if (rows.length === 0) {
    return { passed: false, detail: "Fatima Al Mansouri not found in consignees" };
  }
  const r = rows[0];
  const addressCount = Number(r.address_count);
  const rotationCount = Number(r.rotation_count);
  if (addressCount < 2) {
    return {
      passed: false,
      detail: `Fatima found (${r.consignee_id.slice(0, 8)}...) but only ${addressCount} addresses (need ≥2 — Home + Office)`,
    };
  }
  if (rotationCount < 1) {
    return {
      passed: false,
      detail: `Fatima found with ${addressCount} addresses but no subscription_address_rotations rows`,
    };
  }
  return {
    passed: true,
    detail: `Fatima Al Mansouri has ${addressCount} addresses and ${rotationCount} weekday rotation rows`,
  };
}

async function assertSarahActivePreDemoWithFailedTasks(sql) {
  // Brief v1.10/v1.11 amendment: Sarah is pre-seeded ACTIVE; the live
  // HIGH_RISK flip is the demo-theater action during Chapter 5. If
  // she's already HIGH_RISK at verify-time, the theater fails because
  // there's nothing on-stage to flip.
  //
  // FAILED-task window: 14 days backwards from now. Wider than the
  // brief's literal "history" so seasonal task-generation cycles
  // don't accidentally fall out of scope.
  const rows = await sql`
    SELECT
      c.id          AS consignee_id,
      c.name,
      c.crm_state,
      count(t.id) FILTER (
        WHERE t.internal_status = 'FAILED'
          AND t.delivery_date >= CURRENT_DATE - INTERVAL '14 days'
      )                                       AS failed_recent
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
    return {
      passed: false,
      detail: `Sarah found (${r.consignee_id.slice(0, 8)}...) but crm_state=${r.crm_state} (need ACTIVE pre-demo per brief v1.10/v1.11)`,
    };
  }
  const failed = Number(r.failed_recent);
  if (failed < 2) {
    return {
      passed: false,
      detail: `Sarah ACTIVE pre-demo but only ${failed} FAILED tasks in last 14 days (need ≥2)`,
    };
  }
  return {
    passed: true,
    detail: `Sarah Khouri crm_state=ACTIVE pre-demo with ${failed} FAILED tasks in last 14 days`,
  };
}

async function assertDemoAwbPresent(sql) {
  const rows = await sql`
    SELECT id, external_id, customer_order_number
    FROM tasks
    WHERE external_id = ${AWB_DEMO_FIXTURE}
    LIMIT 1
  `;
  if (rows.length === 0) {
    return {
      passed: false,
      detail: `no task with external_id = '${AWB_DEMO_FIXTURE}' (SF push pipeline did not produce expected fixture AWB)`,
    };
  }
  const t = rows[0];
  return {
    passed: true,
    detail: `task ${t.id.slice(0, 8)}... carries external_id=${AWB_DEMO_FIXTURE} (customer_order_number=${t.customer_order_number})`,
  };
}

async function assertAtLeastOneTaskWithPodPhotos(sql) {
  const rows = await sql`
    SELECT count(*)::int AS n
    FROM tasks
    WHERE pod_photos IS NOT NULL
  `;
  const n = rows[0].n;
  if (n < 1) {
    return {
      passed: false,
      detail: "no tasks with pod_photos populated — webhook → POD-extraction pipeline not exercised",
    };
  }
  return { passed: true, detail: `${n} tasks with pod_photos populated` };
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

async function main() {
  const dbUrl = need("SUPABASE_DATABASE_URL");
  console.log(`[${nowIso()}] verify-demo-seed start`);

  const sql = postgres(dbUrl, { max: 1, prepare: false });

  const assertions = [
    { label: "1. Demo Bistro tenant + suitefleet_customer_code", run: () => assertDemoBistroWithCustomerCode(sql) },
    { label: "2. Fatima ≥2 addresses + rotation rules", run: () => assertFatimaAddressesAndRotation(sql) },
    { label: "3. Sarah ACTIVE pre-demo + ≥2 FAILED tasks last 14d", run: () => assertSarahActivePreDemoWithFailedTasks(sql) },
    { label: `4. AWB ${AWB_DEMO_FIXTURE} on tasks.external_id`, run: () => assertDemoAwbPresent(sql) },
    { label: "5. ≥1 task with pod_photos populated", run: () => assertAtLeastOneTaskWithPodPhotos(sql) },
  ];

  let passCount = 0;
  let failCount = 0;
  for (const a of assertions) {
    let result;
    try {
      result = await a.run();
    } catch (err) {
      result = { passed: false, detail: `query error: ${err.message}` };
    }
    const tag = result.passed ? "PASS" : "FAIL";
    console.log(`[${tag}] ${a.label} — ${result.detail}`);
    if (result.passed) passCount += 1;
    else failCount += 1;
  }

  await sql.end({ timeout: 5 });

  console.log("");
  console.log(`[${nowIso()}] verify-demo-seed summary: ${passCount} pass / ${failCount} fail`);
  process.exit(failCount === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`[verify-demo-seed] FATAL: ${err.message}`);
  process.exit(2);
});
