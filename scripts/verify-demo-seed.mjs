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
//   1. Demo Bistro slug 'demo-bistro' is ABSENT pre-demo. Proves
//      the slug is free for the Chapter-2 Transcorp-staff onboarding
//      narrative (Demo Bistro is created LIVE on stage; if it
//      already exists, the live-create step collides with 409).
//   2. Fatima Al Mansouri consignee exists with ≥2 addresses
//      (Home + Office) and per-weekday rotation rule rows present.
//      Proves brief §5.2 Q9-Q10 address-rotation storyline data.
//   3. Sarah Khouri consignee exists at crm_state='ACTIVE' (NOT
//      HIGH_RISK pre-demo per brief v1.10/v1.11) with ≥2 tasks in
//      status='FAILED' across the last 14 days. Proves the demo-
//      theater pre-condition: live HIGH_RISK flip is the on-stage
//      action, not a pre-seed invariant.
//   4. ≥1 task has an MPL-prefix AWB on external_tracking_number.
//      Proves the SF push pipeline produced real data end-to-end
//      for the MPL merchant. (Was a hardcoded fixture AWB pre-Day-24
//      — relaxed to prefix match so the assertion stays green as
//      the cron generates new pushes day over day.)
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

const AWB_PREFIX = "MPL-";

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

async function assertDemoBistroSlugAbsentPreDemo(sql) {
  // Brief §5.3 Chapter 2 — Demo Bistro is onboarded LIVE on stage
  // by the Transcorp-staff actor. If the slug 'demo-bistro' already
  // exists pre-demo, the live-create step collides with a 409 and
  // the chapter falls flat. Smoke-time invariant is therefore the
  // INVERSE of the demo-time state: pre-demo absent, post-demo
  // present (post-demo state is not this verifier's concern).
  const rows = await sql`
    SELECT id, slug, status
    FROM tenants
    WHERE slug = 'demo-bistro'
  `;
  if (rows.length > 0) {
    const t = rows[0];
    return {
      passed: false,
      detail: `slug 'demo-bistro' already present (id=${t.id.slice(0, 8)}..., status=${t.status}) — Chapter-2 live-create will collide with 409`,
    };
  }
  return { passed: true, detail: "slug 'demo-bistro' is absent — free for Chapter-2 live-create" };
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

async function assertMplPrefixAwbPresent(sql) {
  // AWBs land on tasks.external_tracking_number (NOT tasks.external_id
  // — that column holds SF's numeric internal task ID). MPL- prefix
  // is the AWB shape SuiteFleet mints for the meal-plan merchant. A
  // green count proves the SF push pipeline produced real data end-
  // to-end for MPL without locking the assertion to a specific AWB
  // that goes stale day over day as the cron generates new tasks.
  const pattern = `${AWB_PREFIX}%`;
  const rows = await sql`
    SELECT count(*)::int AS n
    FROM tasks
    WHERE external_tracking_number LIKE ${pattern}
  `;
  const n = rows[0].n;
  if (n < 1) {
    return {
      passed: false,
      detail: `no tasks with external_tracking_number LIKE '${pattern}' — SF push pipeline produced no MPL-prefix AWBs`,
    };
  }
  return {
    passed: true,
    detail: `${n} tasks carry an ${AWB_PREFIX}-prefix AWB on external_tracking_number`,
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
    { label: "1. 'demo-bistro' slug absent pre-demo", run: () => assertDemoBistroSlugAbsentPreDemo(sql) },
    { label: "2. Fatima ≥2 addresses + rotation rules", run: () => assertFatimaAddressesAndRotation(sql) },
    { label: "3. Sarah ACTIVE pre-demo + ≥2 FAILED tasks last 14d", run: () => assertSarahActivePreDemoWithFailedTasks(sql) },
    { label: `4. ≥1 task with ${AWB_PREFIX}-prefix AWB on external_tracking_number`, run: () => assertMplPrefixAwbPresent(sql) },
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
