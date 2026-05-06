#!/usr/bin/env node
/**
 * Posture B / auth-posture audit probe — reusable for any future auth-posture audit.
 *
 * Captures the 4-gate Stage-1 pre-flight check pattern (P1-P4) used to confirm
 * that ALLOW_DEMO_AUTH env-var was safely removed from Production + Preview scopes
 * during the Posture B retirement Day-15 morning. Generalizes to any future
 * env-var-gated auth-posture rollback by parameterizing the env-var name.
 *
 * Status: durable. Header rewritten Day 16 (PR #<TBD>) per plan-sync bundle item 5.
 * Originally filed as ephemeral Day-13 evening; promoted Day-15 evening per
 * Day-15 EOD §7.1.
 */

import { config as loadEnv } from "dotenv";
import postgres from "postgres";

loadEnv({ path: ".env.local", quiet: true });

const url = process.env.SUPABASE_DATABASE_URL;
if (!url) {
  console.error("SUPABASE_DATABASE_URL not set in .env.local");
  process.exit(2);
}

const sql = postgres(url, { max: 1, prepare: false, idle_timeout: 5 });

try {
  // Schema introspection — runbook example uses created_at but audit_events
  // may use a different column. Surface the column list first.
  const cols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'audit_events'
    ORDER BY ordinal_position
  `;
  console.log(JSON.stringify({ audit_events_columns: cols.map(c => c.column_name) }, null, 2));

  // Pick the timestamp column: prefer occurred_at, then created_at, then emitted_at
  const tsCol =
    cols.find(c => c.column_name === 'occurred_at') ? 'occurred_at' :
    cols.find(c => c.column_name === 'created_at')  ? 'created_at'  :
    cols.find(c => c.column_name === 'emitted_at')  ? 'emitted_at'  : null;
  if (!tsCol) {
    console.error('No expected timestamp column found on audit_events');
    process.exit(3);
  }
  console.log(`Using timestamp column: ${tsCol}`);

  // P3 — successful logins in last 48h
  const p3 = await sql`
    SELECT COUNT(*)::int AS n
    FROM audit_events
    WHERE event_type = 'user.login_succeeded'
      AND ${sql(tsCol)} > now() - interval '48 hours'
  `;

  // P4 — failed logins in last 48h (with sample of distinct actors for triage)
  const p4Count = await sql`
    SELECT COUNT(*)::int AS n
    FROM audit_events
    WHERE event_type = 'user.login_failed'
      AND ${sql(tsCol)} > now() - interval '48 hours'
  `;
  const p4Sample = await sql`
    SELECT actor_id, COUNT(*)::int AS n
    FROM audit_events
    WHERE event_type = 'user.login_failed'
      AND ${sql(tsCol)} > now() - interval '48 hours'
    GROUP BY actor_id
    ORDER BY n DESC
    LIMIT 5
  `;

  // P5 — three demo merchants each have ≥1 tenant-admin (AMENDED query
  // per runbook §1 amendment history; joins tenants via
  // role_assignments.tenant_id, NOT users.tenant_id)
  const p5 = await sql`
    SELECT t.slug, COUNT(*)::int AS n
    FROM role_assignments ra
    JOIN roles r ON r.id = ra.role_id
    JOIN tenants t ON t.id = ra.tenant_id
    WHERE r.slug = 'tenant-admin'
      AND t.slug IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers')
    GROUP BY t.slug
    ORDER BY t.slug
  `;

  console.log(JSON.stringify({
    p3_login_succeeded_48h: p3[0].n,
    p4_login_failed_48h: p4Count[0].n,
    p4_failed_actor_breakdown: p4Sample,
    p5_tenant_admin_per_demo_merchant: p5,
  }, null, 2));
} finally {
  await sql.end({ timeout: 5 });
}
