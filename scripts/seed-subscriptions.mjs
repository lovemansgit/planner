#!/usr/bin/env node
// scripts/seed-subscriptions.mjs
//
// Day 11 / P3 — operator-run script that seeds consignees + subscriptions
// for one of the 3 P3 MVP merchants (MPL/DNR/FBU). Per
// memory/plans/p3_subscription_seeding_plan.md.
//
// SAFETY POSTURE (mirrors teardown-merchant.mjs):
//   - Default = DRY RUN. Prints what it WOULD insert; makes no changes.
//   - --yes=true required for actual write.
//   - Idempotent — no-op when the tenant has already been seeded
//     (pre-check on external_ref LIKE 'SEED-%'). Re-running is safe.
//   - One merchant per invocation. Operator runs three times for the
//     three P3 merchants.
//
// IDEMPOTENCY DESIGN:
//   external_ref carries a SEED-{MERCHANT}-CON-{NNNN} / SEED-{MERCHANT}-SUB-{NNNN}
//   pattern. The pre-execution check counts existing rows with
//   external_ref LIKE 'SEED-%' for the target tenant and refuses to
//   re-seed if the count is >0. To re-seed, run teardown-merchant.mjs
//   first OR delete the SEED-* rows manually via Supabase SQL. The
//   script does not provide its own --reset because the inverse
//   teardown surface already exists.
//
// USAGE:
//   # Dry run (no changes):
//   npm run seed-subscriptions -- --slug=meal-plan-scheduler
//
//   # Actual write (requires --yes=true):
//   npm run seed-subscriptions -- --slug=meal-plan-scheduler --yes=true
//
// Required env (from .env.local via dotenv):
//   SUPABASE_DATABASE_URL          — superuser pool (BYPASSRLS)

import { config as loadEnv } from "dotenv";
import postgres from "postgres";

import {
  MERCHANT_PROFILES,
  SEED_EXTERNAL_REF_PREFIX,
  mealPlanForIndex,
  regionForIndex,
  syntheticAddressLine,
  syntheticExternalRef,
  syntheticName,
  syntheticPhone,
} from "./seed-subscriptions-config.mjs";

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
  const slug = need(args, "slug", "merchant URL slug, e.g. meal-plan-scheduler");
  const confirmed = args["yes"] === "true";

  const profile = MERCHANT_PROFILES[slug];
  if (!profile) {
    console.error(`Unknown merchant slug: ${slug}`);
    console.error(`Known slugs: ${Object.keys(MERCHANT_PROFILES).join(", ")}`);
    process.exit(2);
  }

  const databaseUrl = needEnv("SUPABASE_DATABASE_URL");
  const sql = postgres(databaseUrl, { prepare: false, max: 4 });

  const today = new Date().toISOString().slice(0, 10);

  try {
    // 1. Look up tenant + verify customer_code is set (cron skip-NULL guard).
    const tenantRows = await sql`
      SELECT id, slug, name, suitefleet_customer_code
      FROM tenants
      WHERE slug = ${slug}
    `;
    if (tenantRows.length === 0) {
      console.error(`Tenant slug=${slug} not found. Run onboard-merchant first.`);
      process.exit(3);
    }
    const tenant = tenantRows[0];
    if (!tenant.suitefleet_customer_code) {
      console.error(
        `Tenant ${slug} has NULL suitefleet_customer_code. Cron skips this tenant; seeding is meaningless.`,
      );
      console.error(
        `Re-run onboard-merchant with --suitefleet-customer-code=<CODE> first.`,
      );
      process.exit(3);
    }
    console.log(`[seed] tenant=${slug} id=${tenant.id} customer_code=${tenant.suitefleet_customer_code}`);

    // 2. Pre-execution check: refuse if already seeded.
    const existing = (
      await sql`
        SELECT count(*)::int AS c
        FROM subscriptions
        WHERE tenant_id = ${tenant.id}
          AND external_ref LIKE ${SEED_EXTERNAL_REF_PREFIX + "%"}
      `
    )[0].c;
    if (existing > 0) {
      console.log(
        `[seed] tenant ${slug} already has ${existing} seeded subscription(s) (external_ref LIKE 'SEED-%').`,
      );
      console.log(`[seed] Refusing to re-seed. To start over, run teardown-merchant + onboard-merchant first.`);
      console.log(`[seed] no-op exit.`);
      return;
    }

    // 3. Build the inventory.
    const consigneePlan = [];
    for (let i = 1; i <= profile.consigneeCount; i++) {
      const region = regionForIndex(profile, i);
      consigneePlan.push({
        index: i,
        name: syntheticName(profile.merchantCode, i),
        phone: syntheticPhone(profile.merchantCode, i),
        addressLine: syntheticAddressLine(profile, i),
        emirateOrRegion: region.region,
        district: region.district,
        externalRef: syntheticExternalRef("CON", profile.merchantCode, i),
        mealPlanName: mealPlanForIndex(profile, i),
        subscriptionExternalRef: syntheticExternalRef("SUB", profile.merchantCode, i),
      });
    }

    console.log(`[seed] plan:`);
    console.log(`  - profile:           ${profile.merchantCode}`);
    console.log(`  - consignees:        ${profile.consigneeCount}`);
    console.log(`  - subscriptions:     ${profile.consigneeCount}`);
    console.log(`  - daysOfWeek:        [${profile.daysOfWeek.join(", ")}]`);
    console.log(
      `  - delivery window:   ${profile.deliveryWindowStart}–${profile.deliveryWindowEnd}`,
    );
    console.log(`  - start_date:        ${today}`);
    console.log(`  - regions:`);
    for (const r of profile.regions) {
      console.log(`      ${r.region} / ${r.district}: ${r.count}`);
    }

    if (!confirmed) {
      console.log("");
      console.log(`[seed] dry run — no changes made.`);
      console.log(`[seed] re-run with --yes=true to actually seed.`);
      return;
    }

    // 4. Seed consignees in batches; collect ids back for subscription
    //    inserts. Batch size 50 keeps the multi-row VALUES list to a
    //    reasonable size in pg_stat without paying per-row round-trip
    //    cost on 500-row merchants.
    const BATCH = 50;
    const consigneeIds = []; // index → uuid

    for (let start = 0; start < consigneePlan.length; start += BATCH) {
      const slice = consigneePlan.slice(start, start + BATCH);
      const inserted = await sql`
        INSERT INTO consignees (
          tenant_id, name, phone, address_line, emirate_or_region, district, external_ref
        )
        VALUES ${sql(
          slice.map((c) => [
            tenant.id,
            c.name,
            c.phone,
            c.addressLine,
            c.emirateOrRegion,
            c.district,
            c.externalRef,
          ]),
        )}
        RETURNING id, external_ref
      `;
      // Map external_ref → id since the multi-row INSERT order is
      // stable in postgres but we don't rely on that — explicit lookup.
      for (const row of inserted) {
        const planRow = slice.find((c) => c.externalRef === row.external_ref);
        if (!planRow) {
          throw new Error(`unmatched external_ref in returning rows: ${row.external_ref}`);
        }
        consigneeIds[planRow.index] = row.id;
      }
      console.log(`[seed] consignees: ${start + slice.length} / ${consigneePlan.length}`);
    }

    // 5. Seed subscriptions in batches.
    for (let start = 0; start < consigneePlan.length; start += BATCH) {
      const slice = consigneePlan.slice(start, start + BATCH);
      await sql`
        INSERT INTO subscriptions (
          tenant_id, consignee_id, status, start_date, days_of_week,
          delivery_window_start, delivery_window_end, meal_plan_name, external_ref
        )
        VALUES ${sql(
          slice.map((c) => [
            tenant.id,
            consigneeIds[c.index],
            "active",
            today,
            profile.daysOfWeek,
            profile.deliveryWindowStart,
            profile.deliveryWindowEnd,
            c.mealPlanName,
            c.subscriptionExternalRef,
          ]),
        )}
      `;
      console.log(`[seed] subscriptions: ${start + slice.length} / ${consigneePlan.length}`);
    }

    // 6. Operator hand-off output.
    console.log("");
    console.log("─".repeat(72));
    console.log(`Seeding complete — ${tenant.name}`);
    console.log("─".repeat(72));
    console.log(`Tenant id:           ${tenant.id}`);
    console.log(`Slug:                ${tenant.slug}`);
    console.log(`Customer code:       ${tenant.suitefleet_customer_code}`);
    console.log(`Consignees seeded:   ${profile.consigneeCount}`);
    console.log(`Subscriptions:       ${profile.consigneeCount}`);
    console.log(`First task tick:     next 12:00 UTC cron after ${today}`);
    console.log("─".repeat(72));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
