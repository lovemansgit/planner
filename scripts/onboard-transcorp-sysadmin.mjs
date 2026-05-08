#!/usr/bin/env node
// scripts/onboard-transcorp-sysadmin.mjs
//
// Day 18. Idempotent onboarding CLI for the Transcorp sysadmin user
// + the dedicated 'transcorp' home tenant. Sibling to
// scripts/onboard-merchant.mjs; pattern lifted verbatim where
// applicable. Implements memory/plans/day-18-transcorp-sysadmin-onboarding.md
// §4.
//
// Steps in order (each idempotent):
//   1. Upsert the 'transcorp' tenant row (UNIQUE on slug). status='active',
//      name='Transcorp', suitefleet_customer_code=NULL (excluded from cron β
//      filter; this tenant has no SF presence). pickup_address_* NULL
//      (placeholder; transcorp tenant has no real pickup address).
//      Surface a WARNING log line if the existing row had status!='active'.
//   2. Ensure the global 'transcorp-sysadmin' role row exists (tenant_id IS
//      NULL, slug='transcorp-sysadmin'). Description string mirrors
//      ROLES["transcorp-sysadmin"].description from
//      src/modules/identity/roles.ts:186-187 verbatim. Permissions live in
//      the frozen code catalogue at src/modules/identity/roles.ts; this row
//      is identity-only.
//   3. Create the Supabase Auth user via supabase.auth.admin.createUser
//      with email_confirm: true. If the user already exists, look up via
//      listUsers fallback and continue (idempotent re-run).
//   4. Pre-check email-collision with another tenant: SELECT tenant_id FROM
//      users WHERE id = <authUserId>. If a row exists with tenant_id !=
//      transcorp tenant id, FAIL FAST — silently rewriting users.tenant_id
//      would break that user's existing operator login. Then upsert the
//      public.users mirror row (id = auth user's id, tenant_id = transcorp
//      tenant). ON CONFLICT (id) — idempotent.
//   5. Insert role_assignments → transcorp-sysadmin for the user.
//      ON CONFLICT (user_id, role_id, tenant_id) DO NOTHING — idempotent.
//   6. Print the operator hand-off summary: tenant id, slug, admin email,
//      login URL. Password is NEVER echoed (operator already supplied it
//      via the --admin-password CLI flag).
//
// Usage (from repo root):
//   npm run onboard-transcorp-sysadmin -- \
//     --admin-email=transcorp-admin@planner.test \
//     --admin-password=<one-time>
//
// Env loading: the script auto-loads `.env.local` from the repo root via
// dotenv. No `set -a && source .env.local && set +a` prefix needed. If a
// variable is already set in the parent shell environment, the shell value
// wins (dotenv's default — non-overriding).
//
// Required env (typically from .env.local):
//   SUPABASE_DATABASE_URL          — superuser pool (BYPASSRLS)
//   NEXT_PUBLIC_SUPABASE_URL       — Supabase project URL
//   SUPABASE_SERVICE_ROLE_KEY      — admin Auth API key
//   PUBLIC_BASE_URL                — base URL for the login screen (defaults
//                                    to the production URL)

import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

loadEnv({ path: ".env.local", quiet: true });

const ARG_PATTERN = /^--([a-z][a-z0-9-]*)=(.*)$/;

const TRANSCORP_TENANT_SLUG = "transcorp";
const TRANSCORP_TENANT_NAME = "Transcorp";
const TRANSCORP_SYSADMIN_ROLE_SLUG = "transcorp-sysadmin";
const TRANSCORP_SYSADMIN_ROLE_NAME = "Transcorp Sysadmin";
// Description string mirrors ROLES["transcorp-sysadmin"].description at
// src/modules/identity/roles.ts:186-187 verbatim. If roles.ts diverges,
// land a T1 fixup re-syncing this string.
const TRANSCORP_SYSADMIN_ROLE_DESCRIPTION =
  "Transcorp engineering staff. Full cross-tenant access including migration import. Highest-privilege role. Use is logged in the audit trail under actor_kind='user' with the staff member's user id.";

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
  const adminEmail = need(args, "admin-email", "transcorp sysadmin user's email");
  const adminPassword = need(args, "admin-password", "transcorp sysadmin user's one-time password");

  const databaseUrl = needEnv("SUPABASE_DATABASE_URL");
  const supabaseUrl = needEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = needEnv("SUPABASE_SERVICE_ROLE_KEY");
  const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? "https://planner-olive-sigma.vercel.app";

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const sql = postgres(databaseUrl, { prepare: false, max: 2 });

  try {
    // --------------------------------------------------------------------
    // 1. Upsert the 'transcorp' tenant row.
    // --------------------------------------------------------------------
    // 1a. Read prior state so we can surface a WARNING if the existing
    //     row had status != 'active' (operator manually muted, or some
    //     prior teardown left it in a non-active state).
    const priorRows = await sql`
      SELECT id, status FROM tenants WHERE slug = ${TRANSCORP_TENANT_SLUG} LIMIT 1
    `;
    if (priorRows.length > 0 && priorRows[0].status !== "active") {
      console.log(
        `[onboard] WARNING: existing '${TRANSCORP_TENANT_SLUG}' tenant had status='${priorRows[0].status}'; restoring to 'active'`,
      );
    }

    // 1b. Upsert. suitefleet_customer_code stays NULL on insert (β cron
    //     filter excludes it correctly). pickup_address_* stay NULL.
    const tenantRows = await sql`
      INSERT INTO tenants (slug, name, status)
      VALUES (${TRANSCORP_TENANT_SLUG}, ${TRANSCORP_TENANT_NAME}, 'active')
      ON CONFLICT (slug)
      DO UPDATE SET
        status = 'active',
        name = ${TRANSCORP_TENANT_NAME},
        updated_at = now()
      RETURNING id
    `;
    const tenantId = tenantRows[0].id;
    console.log(`[onboard] tenant=${TRANSCORP_TENANT_SLUG} id=${tenantId}`);

    // --------------------------------------------------------------------
    // 2. Ensure the global 'transcorp-sysadmin' role row exists.
    // --------------------------------------------------------------------
    // tenant_id IS NULL (built-in role visible to every tenant). Permission
    // set is resolved at runtime from src/modules/identity/roles.ts:183.
    await sql`
      INSERT INTO roles (tenant_id, name, slug, description)
      VALUES (
        NULL,
        ${TRANSCORP_SYSADMIN_ROLE_NAME},
        ${TRANSCORP_SYSADMIN_ROLE_SLUG},
        ${TRANSCORP_SYSADMIN_ROLE_DESCRIPTION}
      )
      ON CONFLICT (tenant_id, slug) DO NOTHING
    `;
    const roleRows = await sql`
      SELECT id FROM roles WHERE tenant_id IS NULL AND slug = ${TRANSCORP_SYSADMIN_ROLE_SLUG} LIMIT 1
    `;
    const roleId = roleRows[0].id;
    console.log(`[onboard] role=${TRANSCORP_SYSADMIN_ROLE_SLUG} id=${roleId}`);

    // --------------------------------------------------------------------
    // 3. Create the Supabase Auth user (or fetch existing).
    // --------------------------------------------------------------------
    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
    });

    let userId;
    if (createErr) {
      const lower = adminEmail.toLowerCase();
      const { data: list, error: listErr } = await adminClient.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });
      if (listErr) {
        console.error(`Auth user create failed and listUsers fallback also failed:`);
        console.error(`  create error: ${createErr.message}`);
        console.error(`  list error:   ${listErr.message}`);
        process.exit(3);
      }
      const existing = (list?.users ?? []).find((u) => (u.email ?? "").toLowerCase() === lower);
      if (!existing) {
        console.error(`Auth user create failed: ${createErr.message}`);
        process.exit(3);
      }
      userId = existing.id;
      console.log(`[onboard] auth user already exists; reusing id=${userId}`);
    } else {
      userId = created.user.id;
      console.log(`[onboard] auth user created id=${userId}`);
    }

    // --------------------------------------------------------------------
    // 4. Email-collision FAIL FAST + upsert public.users mirror.
    // --------------------------------------------------------------------
    // If a public.users row already exists for this auth user with a
    // different tenant_id, abort. Silently rewriting tenant_id would
    // break that user's existing operator login (e.g. mpl-admin pointed
    // at MPL would suddenly point at transcorp).
    const existingMirror = await sql`
      SELECT tenant_id FROM users WHERE id = ${userId} LIMIT 1
    `;
    if (existingMirror.length > 0 && existingMirror[0].tenant_id !== tenantId) {
      console.error(
        `Email ${adminEmail} is already provisioned for a different tenant ` +
          `(id=${existingMirror[0].tenant_id}); aborting to avoid silent rewrite. ` +
          `Use a fresh email for the Transcorp sysadmin user.`,
      );
      process.exit(4);
    }

    await sql`
      INSERT INTO users (id, tenant_id, email, display_name)
      VALUES (${userId}, ${tenantId}, ${adminEmail}, 'Transcorp Admin')
      ON CONFLICT (id)
      DO UPDATE SET
        email = EXCLUDED.email,
        tenant_id = EXCLUDED.tenant_id,
        disabled_at = NULL,
        updated_at = now()
    `;
    console.log(`[onboard] mirror row upserted user=${userId} tenant=${tenantId}`);

    // --------------------------------------------------------------------
    // 5. Insert role assignment.
    // --------------------------------------------------------------------
    await sql`
      INSERT INTO role_assignments (user_id, role_id, tenant_id)
      VALUES (${userId}, ${roleId}, ${tenantId})
      ON CONFLICT (user_id, role_id, tenant_id) DO NOTHING
    `;
    console.log(`[onboard] role_assignment ensured`);

    // --------------------------------------------------------------------
    // 6. Operator hand-off output. Password is NEVER echoed.
    // --------------------------------------------------------------------
    const trimmedBase = publicBaseUrl.replace(/\/+$/, "");
    const loginUrl = `${trimmedBase}/login`;
    console.log("");
    console.log("─".repeat(72));
    console.log(`Onboarding complete — Transcorp Sysadmin`);
    console.log("─".repeat(72));
    console.log(`Tenant id:        ${tenantId}`);
    console.log(`Tenant slug:      ${TRANSCORP_TENANT_SLUG}`);
    console.log(`Role:             ${TRANSCORP_SYSADMIN_ROLE_SLUG}`);
    console.log(`Admin email:      ${adminEmail}`);
    console.log(`Login URL:        ${loginUrl}`);
    console.log("─".repeat(72));
    console.log(`Note: password not echoed; you supplied it via --admin-password.`);
    console.log(`Log in with the email + password and navigate to /admin/merchants.`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
