#!/usr/bin/env node
// scripts/probe-fbu-seed-counts-readonly.mjs
//
// Fresh Butchers seed-vs-real COUNT probe — STRICTLY READ-ONLY.
// SELECT only. Wrapped in an explicit `SET TRANSACTION READ ONLY` so the
// server itself rejects any accidental write. No INSERT/UPDATE/DELETE/DDL.
//
// Proves the junk-vs-real split before Love authorizes the Option-A hide:
//   - junk marker = external_ref LIKE 'SEED-FBU-%' on consignees/subscriptions
//   - tasks carry no marker; junk-by-association via parent FK
//
// PII posture: NO customer names/phones/emails are printed. Real (non-marked)
// rows are reported as bucketed counts + created_at ranges only.
//
// Required env (.env.local via dotenv): SUPABASE_DATABASE_URL (prod pooler).
import { config as loadEnv } from "dotenv";
import postgres from "postgres";

loadEnv({ path: ".env.local", quiet: true });

const dbUrl = process.env.SUPABASE_DATABASE_URL;
if (!dbUrl) { console.error("missing SUPABASE_DATABASE_URL"); process.exit(1); }
const sql = postgres(dbUrl, { max: 1, prepare: false });

const SLUG = "fresh-butchers";
const MARK = "SEED-FBU-%";

try {
  await sql.begin(async (tx) => {
    await tx.unsafe("SET TRANSACTION READ ONLY");

    // host sanity (confirm we are on the intended prod cluster)
    const [{ db, host }] = await tx`
      SELECT current_database() AS db,
             inet_server_addr()::text AS host`;

    const [tenant] = await tx`
      SELECT id, slug, name, status, suitefleet_customer_code
      FROM tenants WHERE slug = ${SLUG}`;
    if (!tenant) { console.error(`tenant ${SLUG} not found`); return; }

    // 1. CONSIGNEES split
    const [con] = await tx`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE external_ref LIKE ${MARK})::int AS junk,
             count(*) FILTER (WHERE external_ref IS NULL OR external_ref NOT LIKE ${MARK})::int AS real
      FROM consignees WHERE tenant_id = ${tenant.id}`;

    // 2. SUBSCRIPTIONS split
    const [sub] = await tx`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE external_ref LIKE ${MARK})::int AS junk,
             count(*) FILTER (WHERE external_ref IS NULL OR external_ref NOT LIKE ${MARK})::int AS real
      FROM subscriptions WHERE tenant_id = ${tenant.id}`;

    // 3. TASKS split (junk-by-association: either parent marked)
    const [task] = await tx`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE c.external_ref LIKE ${MARK} OR s.external_ref LIKE ${MARK})::int AS junk,
             count(*) FILTER (WHERE (c.external_ref IS NULL OR c.external_ref NOT LIKE ${MARK})
                                AND (s.external_ref IS NULL OR s.external_ref NOT LIKE ${MARK}))::int AS real
      FROM tasks tk
      LEFT JOIN consignees c ON c.id = tk.consignee_id
      LEFT JOIN subscriptions s ON s.id = tk.subscription_id
      WHERE tk.tenant_id = ${tenant.id}`;

    // 4a. SAFETY — marked rows that DON'T look like seed (would mean marker is over-broad)
    const [conMarkOdd] = await tx`
      SELECT count(*) FILTER (WHERE external_ref LIKE ${MARK} AND name NOT LIKE 'FBU Customer %')::int AS marked_odd_name,
             count(*) FILTER (WHERE external_ref LIKE ${MARK} AND (phone IS NULL OR phone NOT LIKE '+971540%'))::int AS marked_odd_phone,
             min(created_at) FILTER (WHERE external_ref LIKE ${MARK}) AS marked_min_created,
             max(created_at) FILTER (WHERE external_ref LIKE ${MARK}) AS marked_max_created
      FROM consignees WHERE tenant_id = ${tenant.id}`;

    // 4b. SAFETY — UNMARKED rows that LOOK like junk (would mean marker misses some junk)
    const [conUnmarkedJunky] = await tx`
      SELECT count(*)::int AS unmarked_looks_junk
      FROM consignees
      WHERE tenant_id = ${tenant.id}
        AND (external_ref IS NULL OR external_ref NOT LIKE ${MARK})
        AND (name LIKE 'FBU Customer %' OR phone LIKE '+971540%')`;

    // 4c. Characterise the REAL (unmarked) consignees WITHOUT leaking PII
    const [realProfile] = await tx`
      SELECT count(*) FILTER (WHERE external_ref IS NULL)::int AS ref_null,
             count(*) FILTER (WHERE external_ref IS NOT NULL AND external_ref NOT LIKE 'SEED-%')::int AS ref_real,
             count(*) FILTER (WHERE external_ref LIKE 'SEED-%' AND external_ref NOT LIKE ${MARK})::int AS ref_other_seed,
             min(created_at) AS min_created, max(created_at) AS max_created
      FROM consignees
      WHERE tenant_id = ${tenant.id}
        AND (external_ref IS NULL OR external_ref NOT LIKE ${MARK})`;

    // 4d. Same over subscriptions (marker over-broad / missed-junk checks)
    const [subSafety] = await tx`
      SELECT count(*) FILTER (WHERE external_ref LIKE ${MARK})::int AS marked,
             count(*) FILTER (WHERE external_ref LIKE ${MARK} AND status <> 'active')::int AS marked_not_active,
             count(*) FILTER (WHERE (external_ref IS NULL OR external_ref NOT LIKE ${MARK}))::int AS unmarked
      FROM subscriptions WHERE tenant_id = ${tenant.id}`;

    const fmt = (d) => (d ? new Date(d).toISOString() : "—");
    const P = (s) => console.log(s);
    P("");
    P("════════════════════════════════════════════════════════════════");
    P(`  FRESH BUTCHERS seed-vs-real probe  (READ ONLY)`);
    P("════════════════════════════════════════════════════════════════");
    P(`  db=${db} server=${host ?? "(pooler-masked)"}`);
    P(`  tenant: ${tenant.slug} / "${tenant.name}"  status=${tenant.status}  sf_code=${tenant.suitefleet_customer_code}`);
    P("────────────────────────────────────────────────────────────────");
    P(`  CONSIGNEES     total=${con.total}   junk(SEED-FBU-%)=${con.junk}   real=${con.real}`);
    P(`  SUBSCRIPTIONS  total=${sub.total}   junk(SEED-FBU-%)=${sub.junk}   real=${sub.real}`);
    P(`  TASKS          total=${task.total}   junk(by parent)=${task.junk}   real=${task.real}`);
    P("────────────────────────────────────────────────────────────────");
    P(`  SAFETY — marker over-broad? (marked rows that don't look like seed)`);
    P(`    consignees marked but name != 'FBU Customer %' : ${conMarkOdd.marked_odd_name}`);
    P(`    consignees marked but phone != '+971540%'      : ${conMarkOdd.marked_odd_phone}`);
    P(`    marked consignee created_at range              : ${fmt(conMarkOdd.marked_min_created)}  →  ${fmt(conMarkOdd.marked_max_created)}`);
    P(`    subscriptions marked but status != 'active'    : ${subSafety.marked_not_active}`);
    P("");
    P(`  SAFETY — marker misses junk? (unmarked rows that look like seed)`);
    P(`    consignees unmarked but look junky (name/phone): ${conUnmarkedJunky.unmarked_looks_junk}`);
    P("");
    P(`  REAL (unmarked) consignees profile — PII-free buckets`);
    P(`    external_ref NULL                              : ${realProfile.ref_null}`);
    P(`    external_ref real (non-SEED)                   : ${realProfile.ref_real}`);
    P(`    external_ref other SEED- (non-FBU)             : ${realProfile.ref_other_seed}`);
    P(`    created_at range                               : ${fmt(realProfile.min_created)}  →  ${fmt(realProfile.max_created)}`);
    P("════════════════════════════════════════════════════════════════");
    P("");
  });
} finally {
  await sql.end({ timeout: 5 });
}
