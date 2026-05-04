#!/usr/bin/env node
// scripts/teardown-merchant.mjs
//
// Day 10. Inverse of scripts/onboard-merchant.mjs — deletes a merchant
// tenant and its directly-attached identity rows (auth.users + public.users
// + role_assignments + audit_events). Designed for ad-hoc cleanup of
// throwaway test merchants (e.g. probe-merchant-a/b from the Day-10 P2
// cross-tenant probe).
//
// SAFETY POSTURE:
//   - Default = DRY RUN. Prints what it WOULD delete; makes no changes.
//   - --yes flag opts in to actual deletion. Required for destructive run.
//   - Idempotent — no-op when slug doesn't resolve.
//   - Refuses to operate on tenants whose slug doesn't match the
//     `--allowed-prefix` pattern (default: 'probe-merchant-'). Override
//     via --allowed-prefix=foo to teardown other slug-classes; absent
//     opt-in, the script protects against accidental "give wrong slug"
//     for a real merchant.
//   - Requires explicit per-slug invocation (no glob, no batch). Operator
//     re-runs for each merchant.
//
// FOOTPRINT (per memory/followup_audit_rule_cascade_conflict_cleanup.md):
//   1. Auth users via supabase.auth.admin.deleteUser → cascades:
//      - public.users (FK ON DELETE CASCADE on id)
//      - role_assignments (FK ON DELETE CASCADE on user_id)
//   2. Tenants via DELETE FROM tenants — needs the audit_events_no_delete
//      RULE workaround because audit_events.tenant_id REFERENCES
//      tenants(id) ON DELETE CASCADE conflicts with the append-only
//      RULE. The script disables and re-enables the RULE inside a single
//      transaction; ROLLBACK on any failure restores the RULE.
//
// USAGE:
//   # Dry run (no changes):
//   npm run teardown-merchant -- --slug=probe-merchant-a
//
//   # Actual delete (requires --yes):
//   npm run teardown-merchant -- --slug=probe-merchant-a --yes=true
//
//   # Override allowed-prefix to teardown a different slug class:
//   npm run teardown-merchant -- --slug=other-class-x --allowed-prefix=other-class- --yes=true
//
// Required env (from .env.local via dotenv):
//   SUPABASE_DATABASE_URL          — superuser pool (BYPASSRLS, ALTER privilege)
//   NEXT_PUBLIC_SUPABASE_URL       — Supabase project URL
//   SUPABASE_SERVICE_ROLE_KEY      — admin Auth API key

import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

loadEnv({ path: ".env.local", quiet: true });

const ARG_PATTERN = /^--([a-z][a-z0-9-]*)=(.*)$/;

function parseArgs(argv) {
  const out = {};
  for (const arg of argv.slice(2)) {
    const m = ARG_PATTERN.exec(arg);
    if (!m) {
      console.error(`Unrecognised argument: ${arg}`);
      process.exit(2);
    }
    out[m[1]] = m[2];
  }
  return out;
}

function need(map, name, label) {
  const v = map[name];
  if (!v) {
    console.error(`Missing required argument: --${name} (${label})`);
    process.exit(2);
  }
  return v;
}

function needEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(2);
  }
  return v;
}

async function main() {
  const args = parseArgs(process.argv);
  const slug = need(args, "slug", "merchant URL slug to teardown, e.g. probe-merchant-a");
  const allowedPrefix = args["allowed-prefix"] ?? "probe-merchant-";
  const confirmed = args["yes"] === "true";

  if (!slug.startsWith(allowedPrefix)) {
    console.error(
      `Refusing to teardown slug=${slug} — does not match allowed-prefix='${allowedPrefix}'.`,
    );
    console.error(
      `If this is intentional, pass --allowed-prefix=<prefix> matching the slug.`,
    );
    process.exit(3);
  }

  const databaseUrl = needEnv("SUPABASE_DATABASE_URL");
  const supabaseUrl = needEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = needEnv("SUPABASE_SERVICE_ROLE_KEY");

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const sql = postgres(databaseUrl, { prepare: false, max: 2 });

  try {
    // 1. Look up tenant.
    const tenantRows = await sql`SELECT id, slug, name FROM tenants WHERE slug = ${slug}`;
    if (tenantRows.length === 0) {
      console.log(`[teardown] tenant slug=${slug} not found — nothing to do.`);
      return;
    }
    const { id: tenantId, name: tenantName } = tenantRows[0];
    console.log(`[teardown] target: ${slug} (${tenantId}) "${tenantName}"`);

    // 2. Inventory directly-attached rows.
    const userRows = await sql`SELECT id, email FROM users WHERE tenant_id = ${tenantId}`;
    const roleAssignmentCount = (
      await sql`SELECT count(*)::int AS c FROM role_assignments WHERE tenant_id = ${tenantId}`
    )[0].c;
    const auditCount = (
      await sql`SELECT count(*)::int AS c FROM audit_events WHERE tenant_id = ${tenantId}`
    )[0].c;
    const consigneeCount = (
      await sql`SELECT count(*)::int AS c FROM consignees WHERE tenant_id = ${tenantId}`
    )[0].c;
    const subscriptionCount = (
      await sql`SELECT count(*)::int AS c FROM subscriptions WHERE tenant_id = ${tenantId}`
    )[0].c;
    const taskCount = (
      await sql`SELECT count(*)::int AS c FROM tasks WHERE tenant_id = ${tenantId}`
    )[0].c;

    console.log(`[teardown] inventory:`);
    console.log(`  - public.users:       ${userRows.length}`);
    for (const u of userRows) console.log(`      ${u.id}  ${u.email}`);
    console.log(`  - role_assignments:   ${roleAssignmentCount}`);
    console.log(`  - audit_events:       ${auditCount}`);
    console.log(`  - consignees:         ${consigneeCount}`);
    console.log(`  - subscriptions:      ${subscriptionCount}`);
    console.log(`  - tasks:              ${taskCount}`);

    if (consigneeCount + subscriptionCount + taskCount > 0) {
      console.error(
        `[teardown] REFUSING — tenant has business data (consignees/subscriptions/tasks).`,
      );
      console.error(`  This script is for throwaway test merchants only.`);
      console.error(`  If teardown is genuinely intended, do it via Supabase dashboard.`);
      process.exit(4);
    }

    if (!confirmed) {
      console.log("");
      console.log(`[teardown] dry run — no changes made.`);
      console.log(`[teardown] re-run with --yes=true to actually delete.`);
      return;
    }

    // 3. Delete auth users (cascades public.users → role_assignments).
    for (const u of userRows) {
      const { error } = await adminClient.auth.admin.deleteUser(u.id);
      if (error) {
        console.error(`[teardown] failed to delete auth user ${u.email}: ${error.message}`);
        // Continue — the tenant DELETE below will cascade public.users
        // via tenant_id FK regardless. Auth.users orphan stays; manual
        // cleanup via Supabase dashboard if needed.
      } else {
        console.log(`[teardown] deleted auth user ${u.email} (${u.id})`);
      }
    }

    // 4. Delete tenant — wraps in transaction with audit_events_no_delete
    //    RULE workaround per the cleanup memo. The RULE is briefly
    //    disabled to allow the cascade-delete from tenants → audit_events
    //    to flow; failure inside the transaction triggers ROLLBACK which
    //    restores the RULE state.
    await sql.begin(async (tx) => {
      await tx`ALTER TABLE audit_events DISABLE RULE audit_events_no_delete`;
      const result = await tx`DELETE FROM tenants WHERE id = ${tenantId}`;
      await tx`ALTER TABLE audit_events ENABLE RULE audit_events_no_delete`;
      console.log(`[teardown] deleted ${result.count} tenant row(s) + cascaded children`);
    });

    // 5. Confirmation re-query.
    const stillThere = await sql`SELECT count(*)::int AS c FROM tenants WHERE id = ${tenantId}`;
    if (stillThere[0].c === 0) {
      console.log("");
      console.log("─".repeat(72));
      console.log(`Teardown complete — ${slug}`);
      console.log("─".repeat(72));
    } else {
      console.error(`[teardown] tenant row still present post-DELETE — investigate.`);
      process.exit(5);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
