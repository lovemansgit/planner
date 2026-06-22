#!/usr/bin/env node
// scripts/probe-dnr-mpl-seed-readonly.mjs
//
// DNR + MPL seed-vs-real investigation — STRICTLY READ-ONLY.
// SELECT only, wrapped in SET TRANSACTION READ ONLY. No writes.
//
// Resolves three things:
//   A. INTEGRITY: are MPL- AWB tasks under dr-nutrition genuinely DNR rows
//      (MPL- is just the shared SF sandbox AWB prefix), or cross-tenant
//      mislabeled MPL data? Decisive test: does any task have a parent
//      consignee/subscription in a DIFFERENT tenant than the task?
//   B. Per-merchant junk-vs-real split + every distinct junk pattern.
//   C. Marker safety: does SEED-{CODE}-% catch only junk, miss nothing,
//      and EXCLUDE the demo personas (SEED-DEMO-) + real data?
//
// PII posture: bulk real customer names are NOT printed (bucketed counts
// only). Names ARE shown for rows matching test-like patterns and for the
// ambiguous middle — that is the whole point of the investigation.
//
// Required env (.env.local): SUPABASE_DATABASE_URL (prod pooler).
import { config as loadEnv } from "dotenv";
import postgres from "postgres";

loadEnv({ path: ".env.local", quiet: true });
const dbUrl = process.env.SUPABASE_DATABASE_URL;
if (!dbUrl) { console.error("missing SUPABASE_DATABASE_URL"); process.exit(1); }
const sql = postgres(dbUrl, { max: 1, prepare: false });

const P = (s = "") => console.log(s);
const H = (s) => { P(); P("━".repeat(72)); P("  " + s); P("━".repeat(72)); };

try {
  await sql.begin(async (tx) => {
    await tx.unsafe("SET TRANSACTION READ ONLY");
    const [{ db, host }] = await tx`SELECT current_database() AS db, inet_server_addr()::text AS host`;
    P(`db=${db} server=${host ?? "(masked)"}`);

    const tenants = await tx`
      SELECT id, slug, name, status, suitefleet_customer_code
      FROM tenants WHERE slug IN ('dr-nutrition','meal-plan-scheduler')`;
    const T = {};
    for (const r of tenants) T[r.slug] = r;
    for (const slug of ["dr-nutrition", "meal-plan-scheduler"]) {
      const t = T[slug];
      P(`tenant ${slug}: id=${t?.id} name="${t?.name}" status=${t?.status} sf_code=${t?.suitefleet_customer_code}`);
    }

    // ===================================================================
    // A. INTEGRITY — cross-tenant lineage (the load-bearing question)
    // ===================================================================
    H("A. INTEGRITY — does ANY task have a parent in a different tenant?");
    const crossAll = await tx`
      SELECT t.slug AS task_tenant, ct.slug AS consignee_tenant, st.slug AS sub_tenant, count(*)::int AS n
      FROM tasks tk
      JOIN tenants t ON t.id = tk.tenant_id
      LEFT JOIN consignees c ON c.id = tk.consignee_id
      LEFT JOIN tenants ct ON ct.id = c.tenant_id
      LEFT JOIN subscriptions s ON s.id = tk.subscription_id
      LEFT JOIN tenants st ON st.id = s.tenant_id
      WHERE (c.tenant_id IS NOT NULL AND c.tenant_id <> tk.tenant_id)
         OR (s.tenant_id IS NOT NULL AND s.tenant_id <> tk.tenant_id)
      GROUP BY 1,2,3 ORDER BY 4 DESC`;
    if (crossAll.length === 0) {
      P("  ✔ ZERO cross-tenant tasks platform-wide — every task's consignee AND subscription share its tenant_id.");
      P("    => No task is mislabeled across merchants. tenant_id is trustworthy.");
    } else {
      P("  ⚠ CROSS-TENANT ROWS FOUND (task_tenant | consignee_tenant | sub_tenant | count):");
      for (const r of crossAll) P(`    ${r.task_tenant} | ${r.consignee_tenant} | ${r.sub_tenant} | ${r.n}`);
    }

    H("A2. The exact rows Love saw — MPL- AWB tasks under dr-nutrition (full lineage)");
    const mplUnderDnr = await tx`
      SELECT count(*)::int AS n,
             count(DISTINCT tk.consignee_id)::int AS consignees,
             count(DISTINCT tk.subscription_id)::int AS subs,
             min(tk.delivery_date) AS min_del, max(tk.delivery_date) AS max_del,
             min(tk.created_at) AS min_cre, max(tk.created_at) AS max_cre
      FROM tasks tk JOIN tenants t ON t.id = tk.tenant_id
      WHERE t.slug = 'dr-nutrition' AND tk.external_tracking_number LIKE 'MPL-%'`;
    P(`  MPL- AWB tasks under dr-nutrition: count=${mplUnderDnr[0].n}, distinct consignees=${mplUnderDnr[0].consignees}, distinct subs=${mplUnderDnr[0].subs}`);
    P(`    delivery_date range ${mplUnderDnr[0].min_del ?? "—"} → ${mplUnderDnr[0].max_del ?? "—"};  created_at ${mplUnderDnr[0].min_cre ?? "—"} → ${mplUnderDnr[0].max_cre ?? "—"}`);
    const mplSample = await tx`
      SELECT tk.external_tracking_number AS awb, tk.customer_order_number AS ord,
             tk.created_via, tk.internal_status AS status, tk.delivery_date,
             ct.slug AS consignee_tenant, c.external_ref AS consignee_ref, c.name AS consignee_name,
             st.slug AS sub_tenant, s.external_ref AS sub_ref
      FROM tasks tk JOIN tenants t ON t.id = tk.tenant_id
      LEFT JOIN consignees c ON c.id = tk.consignee_id LEFT JOIN tenants ct ON ct.id = c.tenant_id
      LEFT JOIN subscriptions s ON s.id = tk.subscription_id LEFT JOIN tenants st ON st.id = s.tenant_id
      WHERE t.slug = 'dr-nutrition' AND tk.external_tracking_number LIKE 'MPL-%'
      ORDER BY tk.created_at LIMIT 8`;
    P(`  sample (up to 8):`);
    for (const r of mplSample)
      P(`    awb=${r.awb} ord=${r.ord} via=${r.created_via} ${r.status} del=${r.delivery_date} | consignee[${r.consignee_tenant}] ref=${r.consignee_ref} name="${r.consignee_name}" | sub[${r.sub_tenant}] ref=${r.sub_ref}`);

    H("A3. AWB prefix distribution per tenant (is MPL- the universal sandbox prefix?)");
    const awbPrefix = await tx`
      SELECT t.slug, split_part(tk.external_tracking_number, '-', 1) AS prefix, count(*)::int AS n
      FROM tasks tk JOIN tenants t ON t.id = tk.tenant_id
      WHERE t.slug IN ('dr-nutrition','meal-plan-scheduler') AND tk.external_tracking_number IS NOT NULL
      GROUP BY 1,2 ORDER BY 1,3 DESC`;
    for (const r of awbPrefix) P(`    ${r.slug}: prefix '${r.prefix}-' × ${r.n}`);

    // ===================================================================
    // B + C. Per-merchant junk-vs-real + marker safety
    // ===================================================================
    for (const slug of ["dr-nutrition", "meal-plan-scheduler"]) {
      const t = T[slug];
      if (!t) { P(`\n(no tenant ${slug})`); continue; }
      const tid = t.id;
      const code = slug === "dr-nutrition" ? "DNR" : "MPL";
      const MARK = `SEED-${code}-%`;

      H(`${code} (${slug}) — consignees by external_ref bucket`);
      const conRef = await tx`
        SELECT count(*)::int AS total,
          count(*) FILTER (WHERE external_ref LIKE ${MARK})::int AS seed_code,
          count(*) FILTER (WHERE external_ref LIKE 'SEED-DEMO-%')::int AS seed_demo,
          count(*) FILTER (WHERE external_ref LIKE 'SEED-%' AND external_ref NOT LIKE ${MARK} AND external_ref NOT LIKE 'SEED-DEMO-%')::int AS seed_other,
          count(*) FILTER (WHERE external_ref IS NOT NULL AND external_ref NOT LIKE 'SEED-%')::int AS real_ref,
          count(*) FILTER (WHERE external_ref IS NULL)::int AS ref_null
        FROM consignees WHERE tenant_id = ${tid}`;
      const r = conRef[0];
      P(`  total=${r.total}  SEED-${code}-(bulk junk)=${r.seed_code}  SEED-DEMO-(personas)=${r.seed_demo}  other-SEED=${r.seed_other}  real-ref(non-SEED)=${r.real_ref}  ref-NULL=${r.ref_null}`);

      H(`${code} — consignees by NAME pattern (surface manual/UI test junk that has NO marker)`);
      const conName = await tx`
        SELECT count(*) FILTER (WHERE name LIKE ${code + " Customer %"})::int AS code_customer,
               count(*) FILTER (WHERE name ILIKE '%gate 18%')::int AS gate18,
               count(*) FILTER (WHERE name ILIKE '%wire test%')::int AS wire_test,
               count(*) FILTER (WHERE name ILIKE '%test%')::int AS has_test,
               count(*) FILTER (WHERE name ILIKE 'love mansukhani')::int AS love,
               count(*) FILTER (WHERE name ILIKE '%fatima%')::int AS fatima,
               count(*) FILTER (WHERE name ILIKE '%sarah%')::int AS sarah
        FROM consignees WHERE tenant_id = ${tid}`;
      const n = conName[0];
      P(`  name~'${code} Customer #'=${n.code_customer}  'gate 18'=${n.gate18}  'wire test'=${n.wire_test}  contains 'test'=${n.has_test}  'love mansukhani'=${n.love}  fatima=${n.fatima}  sarah=${n.sarah}`);

      H(`${code} — the AMBIGUOUS middle: consignees NOT matching SEED-${code}- AND NOT a clean bulk name (names shown for ruling)`);
      const shown = await tx`
        SELECT c.name, c.external_ref, c.crm_state, c.created_at,
               (SELECT count(*) FROM subscriptions s WHERE s.consignee_id = c.id)::int AS subs,
               (SELECT count(*) FROM tasks tk WHERE tk.consignee_id = c.id)::int AS tasks
        FROM consignees c
        WHERE c.tenant_id = ${tid}
          AND (c.external_ref IS NULL OR c.external_ref NOT LIKE ${MARK})
        ORDER BY c.created_at`;
      P(`  ${shown.length} consignee(s) are NOT SEED-${code}- marked. Listing (name | external_ref | crm_state | subs | tasks | created):`);
      for (const x of shown.slice(0, 60))
        P(`    "${x.name}" | ${x.external_ref ?? "NULL"} | ${x.crm_state ?? "—"} | subs=${x.subs} tasks=${x.tasks} | ${x.created_at}`);
      if (shown.length > 60) P(`    … +${shown.length - 60} more`);

      H(`${code} — subscriptions & tasks split by SEED-${code}- marker`);
      const subSplit = await tx`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE external_ref LIKE ${MARK})::int AS junk,
               count(*) FILTER (WHERE external_ref LIKE 'SEED-DEMO-%')::int AS demo,
               count(*) FILTER (WHERE external_ref IS NULL OR (external_ref NOT LIKE ${MARK} AND external_ref NOT LIKE 'SEED-DEMO-%'))::int AS other
        FROM subscriptions WHERE tenant_id = ${tid}`;
      const ss = subSplit[0];
      P(`  subscriptions  total=${ss.total}  SEED-${code}-=${ss.junk}  SEED-DEMO-=${ss.demo}  other=${ss.other}`);
      const taskSplit = await tx`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE c.external_ref LIKE ${MARK} OR s.external_ref LIKE ${MARK})::int AS junk_by_seed_code,
               count(*) FILTER (WHERE c.external_ref LIKE 'SEED-DEMO-%' OR s.external_ref LIKE 'SEED-DEMO-%')::int AS demo,
               count(*) FILTER (WHERE (c.external_ref IS NULL OR (c.external_ref NOT LIKE ${MARK} AND c.external_ref NOT LIKE 'SEED-DEMO-%'))
                                  AND (s.external_ref IS NULL OR (s.external_ref NOT LIKE ${MARK} AND s.external_ref NOT LIKE 'SEED-DEMO-%')))::int AS other
        FROM tasks tk
        LEFT JOIN consignees c ON c.id = tk.consignee_id
        LEFT JOIN subscriptions s ON s.id = tk.subscription_id
        WHERE tk.tenant_id = ${tid}`;
      const tk = taskSplit[0];
      P(`  tasks          total=${tk.total}  junk(by SEED-${code}- parent)=${tk.junk_by_seed_code}  demo-parent=${tk.demo}  other=${tk.other}`);

      H(`${code} — MARKER SAFETY for SEED-${code}-%`);
      const safety = await tx`
        SELECT
          (SELECT count(*) FROM consignees WHERE tenant_id=${tid} AND external_ref LIKE ${MARK} AND name NOT LIKE ${code + " Customer %"})::int AS marked_odd_name,
          (SELECT count(*) FROM consignees WHERE tenant_id=${tid} AND external_ref LIKE ${MARK} AND name ILIKE '%fatima%')::int AS marked_fatima,
          (SELECT count(*) FROM consignees WHERE tenant_id=${tid} AND external_ref LIKE ${MARK} AND name ILIKE '%sarah%')::int AS marked_sarah,
          (SELECT count(*) FROM consignees WHERE tenant_id=${tid} AND external_ref LIKE 'SEED-DEMO-%' AND external_ref LIKE ${MARK})::int AS demo_caught_by_marker`;
      const sf = safety[0];
      P(`  marked but name != '${code} Customer #' : ${sf.marked_odd_name}  | marker catches fatima:${sf.marked_fatima} sarah:${sf.marked_sarah} demo:${sf.demo_caught_by_marker} (all must be 0)`);
    }

    P();
    P("━".repeat(72));
    P("  END — read-only, transaction will roll back (no changes).");
    P("━".repeat(72));
    // implicit COMMIT of a READ ONLY tx makes no changes; nothing to roll back.
  });
} finally {
  await sql.end({ timeout: 5 });
}
