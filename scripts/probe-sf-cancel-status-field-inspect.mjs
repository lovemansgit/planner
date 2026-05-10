#!/usr/bin/env node
// Inspect-only — no SF mutation.  Lists candidate target tasks for the Q2 probe.

import postgres from "postgres";

function need(name) {
  const v = process.env[name];
  if (!v) { console.error(`Missing ${name}`); process.exit(1); }
  return v;
}

async function main() {
  const sql = postgres(need("SUPABASE_DATABASE_URL"), { max: 1, prepare: false });

  console.log("=== tenants with suitefleet_customer_code=588 ===");
  const tenants = await sql`
    SELECT id, slug, name, status, created_at
    FROM tenants
    WHERE suitefleet_customer_code = '588'
    ORDER BY created_at ASC
  `;
  for (const t of tenants) {
    console.log(`  ${t.id} | slug=${t.slug} | name="${t.name}" | status=${t.status} | created=${t.created_at.toISOString().slice(0,10)}`);
  }
  console.log(`  total=${tenants.length}`);

  console.log("\n=== CREATED tasks per tenant (push complete) ===");
  for (const t of tenants) {
    const rows = await sql`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE delivery_date < CURRENT_DATE) AS past,
        COUNT(*) FILTER (WHERE delivery_date = CURRENT_DATE) AS today,
        COUNT(*) FILTER (WHERE delivery_date > CURRENT_DATE) AS future,
        MIN(delivery_date) AS oldest,
        MAX(delivery_date) AS newest
      FROM tasks
      WHERE tenant_id = ${t.id}
        AND internal_status = 'CREATED'
        AND external_id IS NOT NULL
        AND external_tracking_number IS NOT NULL
        AND pushed_to_external_at IS NOT NULL
    `;
    const r = rows[0];
    console.log(`  ${t.slug.padEnd(36)} total=${r.total} past=${r.past} today=${r.today} future=${r.future} oldest=${r.oldest?.toISOString?.()?.slice(0,10) ?? "-"} newest=${r.newest?.toISOString?.()?.slice(0,10) ?? "-"}`);
  }

  console.log("\n=== sample task per tenant (oldest CREATED, regardless of delivery_date relative to today) ===");
  for (const t of tenants) {
    const rows = await sql`
      SELECT id, external_id, external_tracking_number, delivery_date, customer_order_number, pushed_to_external_at
      FROM tasks
      WHERE tenant_id = ${t.id}
        AND internal_status = 'CREATED'
        AND external_id IS NOT NULL
        AND external_tracking_number IS NOT NULL
        AND pushed_to_external_at IS NOT NULL
      ORDER BY delivery_date ASC
      LIMIT 1
    `;
    if (rows.length > 0) {
      const r = rows[0];
      console.log(`  ${t.slug}:`);
      console.log(`    task_id=${r.id} awb=${r.external_tracking_number} external_id=${r.external_id} delivery_date=${r.delivery_date.toISOString().slice(0,10)} con=${r.customer_order_number}`);
    }
  }

  await sql.end();
}

main().catch((e) => { console.error(e.stack ?? e.message); process.exit(99); });
