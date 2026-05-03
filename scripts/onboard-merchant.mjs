#!/usr/bin/env node
// scripts/onboard-merchant.mjs
//
// Day 10. Idempotent onboarding CLI for a single merchant tenant + first
// admin user. Ships in the auth wiring PR (per memory/plans/auth_implementation_plan.md
// §4 + §9 — bundled in the auth PR because Preview testing the auth path
// itself requires real auth users to exist).
//
// Steps in order (each idempotent):
//   1. Upsert tenants row (UNIQUE on slug). If suitefleet_customer_code
//      is provided, set or update it.
//   2. Ensure the global `tenant-admin` role row exists (tenant_id IS NULL,
//      slug='tenant-admin'). Permissions live in the frozen code catalogue
//      at src/modules/identity/roles.ts; this row is identity-only.
//   3. Create the Supabase Auth user via supabase.auth.admin.createUser
//      with email_confirm: true (operator hand-off bypasses email
//      verification in pilot — trust seeded users per plan §8 OUT-of-scope
//      list). If the user already exists, look it up and continue.
//   4. Upsert the public.users mirror row (id = auth user's id, tenant_id
//      = the merchant tenant). ON CONFLICT on (id) — idempotent.
//   5. Insert role_assignments → tenant-admin for the user. ON CONFLICT
//      (user_id, role_id, tenant_id) DO NOTHING — idempotent.
//   6. Print the merchant's webhook URL + admin login credentials for
//      operator hand-off (URL composition mirrors src/modules/webhooks's
//      buildWebhookUrl; password is echoed only because the operator
//      supplies it themselves, never generated here).
//
// Usage (from repo root, with .env.local sourced):
//   set -a && source .env.local && set +a
//   npm run onboard-merchant -- \
//     --slug=tabchilli \
//     --name="Tabchilli" \
//     --suitefleet-customer-code=TBC \
//     --admin-email=ops@tabchilli.com \
//     --admin-password=<one-time>
//
// Required env (from .env.local or Vercel CLI shell):
//   SUPABASE_DATABASE_URL          — superuser pool (BYPASSRLS)
//   NEXT_PUBLIC_SUPABASE_URL       — Supabase project URL
//   SUPABASE_SERVICE_ROLE_KEY      — admin Auth API key
//   PUBLIC_BASE_URL                — base URL displayed for the webhook receiver

import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

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
  const slug = need(args, "slug", "merchant URL slug, e.g. tabchilli");
  const name = need(args, "name", "merchant display name");
  const adminEmail = need(args, "admin-email", "first admin user's email");
  const adminPassword = need(args, "admin-password", "first admin user's one-time password");
  const sfCustomerCode = args["suitefleet-customer-code"] ?? null;

  const databaseUrl = needEnv("SUPABASE_DATABASE_URL");
  const supabaseUrl = needEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = needEnv("SUPABASE_SERVICE_ROLE_KEY");
  const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? "https://planner-olive-sigma.vercel.app";

  // Service-role admin client for Supabase Auth admin operations.
  // autoRefreshToken/persistSession off — this script is short-lived.
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const sql = postgres(databaseUrl, { prepare: false, max: 2 });

  try {
    // 1. Upsert tenant.
    const tenantRows = await sql`
      INSERT INTO tenants (slug, name, status, suitefleet_customer_code)
      VALUES (${slug}, ${name}, 'active', ${sfCustomerCode})
      ON CONFLICT (slug)
      DO UPDATE SET
        name = EXCLUDED.name,
        suitefleet_customer_code = COALESCE(EXCLUDED.suitefleet_customer_code, tenants.suitefleet_customer_code),
        updated_at = now()
      RETURNING id, slug
    `;
    const tenantId = tenantRows[0].id;
    console.log(`[onboard] tenant=${slug} id=${tenantId}`);

    // 2. Ensure tenant-admin role row exists (global, tenant_id IS NULL).
    await sql`
      INSERT INTO roles (tenant_id, name, slug, description)
      VALUES (
        NULL,
        'Tenant Admin',
        'tenant-admin',
        'Full administrative access within the tenant. Permissions resolved from the frozen code catalogue at src/modules/identity/roles.ts.'
      )
      ON CONFLICT (tenant_id, slug) DO NOTHING
    `;
    const roleRows = await sql`
      SELECT id FROM roles WHERE tenant_id IS NULL AND slug = 'tenant-admin' LIMIT 1
    `;
    const roleId = roleRows[0].id;
    console.log(`[onboard] role=tenant-admin id=${roleId}`);

    // 3. Create Supabase Auth user (or fetch existing).
    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
    });

    let userId;
    if (createErr) {
      // Idempotency: check if user already exists. The Supabase JS admin
      // API does not expose a getUserByEmail helper directly; listUsers
      // accepts a filter via the page-by-page admin endpoint. For a small
      // pilot we list and filter client-side.
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

    // 4. Upsert public.users mirror.
    await sql`
      INSERT INTO users (id, tenant_id, email)
      VALUES (${userId}, ${tenantId}, ${adminEmail})
      ON CONFLICT (id)
      DO UPDATE SET
        email = EXCLUDED.email,
        tenant_id = EXCLUDED.tenant_id,
        disabled_at = NULL,
        updated_at = now()
    `;
    console.log(`[onboard] mirror row upserted user=${userId} tenant=${tenantId}`);

    // 5. Insert tenant-admin role assignment.
    await sql`
      INSERT INTO role_assignments (user_id, role_id, tenant_id)
      VALUES (${userId}, ${roleId}, ${tenantId})
      ON CONFLICT (user_id, role_id, tenant_id) DO NOTHING
    `;
    console.log(`[onboard] role_assignment ensured`);

    // 6. Operator hand-off output. Webhook URL composition mirrors
    // src/modules/webhooks/buildWebhookUrl.
    const trimmedBase = publicBaseUrl.replace(/\/+$/, "");
    const webhookUrl = `${trimmedBase}/api/webhooks/suitefleet/${tenantId}`;
    console.log("");
    console.log("─".repeat(72));
    console.log(`Onboarding complete — ${name}`);
    console.log("─".repeat(72));
    console.log(`Tenant id:               ${tenantId}`);
    console.log(`Tenant slug:             ${slug}`);
    if (sfCustomerCode) {
      console.log(`SuiteFleet customer code: ${sfCustomerCode}`);
    }
    console.log(`Admin email:             ${adminEmail}`);
    console.log(`Admin password:          ${adminPassword}  (one-time; share via 1Password)`);
    console.log(`Webhook receiver URL:    ${webhookUrl}`);
    console.log("─".repeat(72));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
