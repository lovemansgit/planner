#!/usr/bin/env node
// scripts/seed-demo-personas.mjs
//
// Day 19 — Demo persona seeding for the May 15 internal CAIO demo +
// May 18 external prospect demo. Implements memory/PLANNER_PRODUCT_BRIEF.md
// §5.2 demo-data-state items 7-8 (Fatima Al Mansouri Home/Office address
// rotation; Sarah Khouri HIGH_RISK with failed-delivery history).
//
// =============================================================================
// SCOPE — Q1-Q15 reviewer rulings (Day 19, 2026-05-09)
// =============================================================================
//
//   Q1: Sarah's CRM state at seed time = ACTIVE. Demo theater elevates her
//       to HIGH_RISK live during the show via the real CRM-change API.
//   Q2: Both personas live under tenant slug=meal-plan-scheduler (MPL,
//       sandbox-merchant 588 / customer_code MPL). Demo Bistro is a
//       separate live merchant-creation step; does NOT host these personas.
//   Q3: ≥1 DELIVERED-with-POD for May 15 internal demo gates on Session A's
//       A2 production smoke output. 4 additional cherries for May 18
//       external demo coordinated via Aqib in a separate workstream — NOT
//       in this script's scope.
//   Q4: Demo Bistro is NOT pre-seeded persistently. Created live during
//       demo. demo-preflight.sh gate 1 reframed by reviewer post-A2 smoke
//       to verify "Demo Bistro absent at demo-start". Cross-referenced
//       for awareness, not for action here.
//   Q5: Backdated FAILED tasks for Sarah ACCEPTED with explicit
//       justification: architectural-honesty applies to live-demo-time
//       behavior, not past-state-of-DB. Sarah's failed-delivery history
//       is structural fixture context, not a demo claim about the
//       system's live behavior.
//   Q6: Sarah's FAILED tasks created_via='subscription' (with
//       subscription_id = Sarah's sub). Brief §5.1 "pattern of failed
//       deliveries" reads as recurring/subscription-driven.
//   Q7: 3 backdated FAILED tasks at today−2d / today−4d / today−7d.
//       Sarah's subscription start_date backdated to today−30d to
//       comfortably precede the earliest FAILED task.
//   Q8: Both personas use Mon-Fri 12:00-14:00 Asia/Dubai cadence (matches
//       MPL profile in scripts/seed-subscriptions-config.mjs).
//   Q9: Districts — Fatima home=Jumeirah / office=Business Bay; Sarah
//       home=Al Barsha. All Dubai. All from the MPL profile's regions list.
//   Q10: Fatima meal plan = "5-day veggie box" (MERCHANT_PROFILES
//        meal-plan-scheduler index 0); Sarah = "Weekday plant plan"
//        (index 1). Different plans for visual variation.
//   Q11: Fatima phone +971501234567 / fatima.al-mansouri@example.com;
//        Sarah phone +971502345678 / sarah.khouri@example.com. Verified
//        non-collision against seed-subscriptions ranges (MPL/DNR/FBU
//        consignees use 14-char +971500/520/540 + 7-digit padded patterns;
//        these 13-char +97150{1,2}-prefix numbers occupy distinct
//        positional space).
//   Q12: today via new Date().toISOString().slice(0, 10); offsets via
//        local offsetDays() helper.
//   Q13: customer_order_number = MPL-DEMO-FAIL-001 / 002 / 003 (mirrors
//        AWB-prefix convention; DEMO-FAIL segment grep-friendly).
//   Q14: All 3 FAILED tasks point to Sarah's single home address.
//   Q15: Failure reasons ordered as deteriorating pattern across the
//        3 backdated tasks:
//          today−7d → "Recipient not at address"
//          today−4d → "Building access denied"
//          today−2d → "Recipient declined delivery"
//
// =============================================================================
// CROSS-REFERENCES
// =============================================================================
//
//   - memory/PLANNER_PRODUCT_BRIEF.md §5.2 (demo data state)
//   - memory/PLANNER_PRODUCT_BRIEF.md §5.3 gates 7-8 (preflight verification)
//   - memory/PLANNER_PRODUCT_BRIEF.md §5.1 lines 793 + 801 (demo narrative)
//   - memory/handoffs/day-18-eod.md §6.4 (slipped-from-Day-18 demo data prep)
//   - scripts/seed-subscriptions.mjs (pattern parent)
//   - supabase/migrations/0004_consignee.sql (consignees schema)
//   - supabase/migrations/0006_task.sql (tasks schema)
//   - supabase/migrations/0009_subscription.sql (subscriptions schema)
//   - supabase/migrations/0014_addresses_and_subscription_address_rotations.sql
//   - supabase/migrations/0016_consignee_crm_state_and_events.sql
//     (consignee_timeline_events VIEW; FAILED tasks surface AUTOMATICALLY
//     via the `task_status` UNION branch — no separate insert needed)
//
// =============================================================================
// SAFETY POSTURE
// =============================================================================
//
// Mirrors scripts/seed-subscriptions.mjs:
//   - Default = DRY RUN. Prints what it WOULD insert; makes no changes.
//   - --yes=true required for actual write.
//   - Idempotent — refuses re-seed when SEED-DEMO-* consignees already exist.
//   - Single sql.begin transaction wraps both personas — partial-state
//     impossible.
//
// IDEMPOTENCY:
//   external_ref values: SEED-DEMO-CON-FATIMA / SEED-DEMO-CON-SARAH on
//   consignees; SEED-DEMO-SUB-FATIMA / SEED-DEMO-SUB-SARAH on
//   subscriptions. Pre-execution check counts existing SEED-DEMO-%
//   consignees on the target tenant; if any exist, refuses.
//
// USAGE:
//   # Dry run (no changes):
//   npm run seed-demo-personas
//
//   # Actual write (requires --yes=true):
//   npm run seed-demo-personas -- --yes=true
//
// Required env (.env.local via dotenv):
//   SUPABASE_DATABASE_URL  — superuser pool (BYPASSRLS)
//
// =============================================================================

import { config as loadEnv } from "dotenv";
import postgres from "postgres";

loadEnv({ path: ".env.local", quiet: true });

const ARG_PATTERN = /^--([a-z][a-z0-9-]*)=(.*)$/;
const SEED_DEMO_PREFIX = "SEED-DEMO-";
const TARGET_TENANT_SLUG = "meal-plan-scheduler"; // Per Q2.

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

function needEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(2);
  }
  return v;
}

/** YYYY-MM-DD plus N days (negative → backdate). UTC-anchored. */
function offsetDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// -----------------------------------------------------------------------------
// Persona data — Q9-Q15 locked
// -----------------------------------------------------------------------------

const FATIMA = Object.freeze({
  name: "Fatima Al Mansouri",
  phone: "+971501234567",
  email: "fatima.al-mansouri@example.com",
  consigneeExternalRef: `${SEED_DEMO_PREFIX}CON-FATIMA`,
  subscriptionExternalRef: `${SEED_DEMO_PREFIX}SUB-FATIMA`,
  homeAddress: {
    line: "Villa 12, Jumeirah Beach Road",
    district: "Jumeirah",
    emirate: "Dubai",
  },
  officeAddress: {
    line: "Office 1502, Bay Square Tower 5",
    district: "Business Bay",
    emirate: "Dubai",
  },
  mealPlanName: "5-day veggie box",
  daysOfWeek: [1, 2, 3, 4, 5],
  deliveryWindowStart: "12:00:00",
  deliveryWindowEnd: "14:00:00",
  // Mon-Wed-Fri Home / Tue-Thu Office per brief §5.1 line 793.
  rotation: { 1: "home", 2: "office", 3: "home", 4: "office", 5: "home" },
});

const SARAH = Object.freeze({
  name: "Sarah Khouri",
  phone: "+971502345678",
  email: "sarah.khouri@example.com",
  consigneeExternalRef: `${SEED_DEMO_PREFIX}CON-SARAH`,
  subscriptionExternalRef: `${SEED_DEMO_PREFIX}SUB-SARAH`,
  homeAddress: {
    line: "Apartment 804, Al Barsha Heights",
    district: "Al Barsha",
    emirate: "Dubai",
  },
  mealPlanName: "Weekday plant plan",
  daysOfWeek: [1, 2, 3, 4, 5],
  deliveryWindowStart: "12:00:00",
  deliveryWindowEnd: "14:00:00",
  subscriptionStartDateOffset: -30,
  // Q15 deteriorating-pattern order: oldest → newest reads as "things got
  // worse." Operator drilling into Sarah's timeline sees the trajectory.
  failedTasks: [
    {
      offsetDays: -7,
      customerOrderNumber: "MPL-DEMO-FAIL-001",
      failureReasonComment: "Recipient not at address",
    },
    {
      offsetDays: -4,
      customerOrderNumber: "MPL-DEMO-FAIL-002",
      failureReasonComment: "Building access denied",
    },
    {
      offsetDays: -2,
      customerOrderNumber: "MPL-DEMO-FAIL-003",
      failureReasonComment: "Recipient declined delivery",
    },
  ],
});

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);
  const confirmed = args["yes"] === "true";

  const databaseUrl = needEnv("SUPABASE_DATABASE_URL");
  const sql = postgres(databaseUrl, { prepare: false, max: 4 });

  try {
    // 1. Tenant lookup + active gate.
    const tenantRows = await sql`
      SELECT id, slug, name, suitefleet_customer_code, status
      FROM tenants
      WHERE slug = ${TARGET_TENANT_SLUG}
    `;
    if (tenantRows.length === 0) {
      console.error(
        `Tenant slug=${TARGET_TENANT_SLUG} not found. Run onboard-merchant + seed-subscriptions first.`,
      );
      process.exit(3);
    }
    const tenant = tenantRows[0];
    if (!tenant.suitefleet_customer_code) {
      console.error(
        `Tenant ${TARGET_TENANT_SLUG} has NULL suitefleet_customer_code — pre-seed gate fails.`,
      );
      process.exit(3);
    }
    if (tenant.status !== "active") {
      console.error(
        `Tenant ${TARGET_TENANT_SLUG} status=${tenant.status} (expected 'active').`,
      );
      process.exit(3);
    }
    console.log(
      `[seed-demo] tenant=${tenant.slug} id=${tenant.id} customer_code=${tenant.suitefleet_customer_code} status=${tenant.status}`,
    );

    // 2. Idempotency check.
    const existing = (
      await sql`
        SELECT count(*)::int AS c
        FROM consignees
        WHERE tenant_id = ${tenant.id}
          AND external_ref LIKE ${SEED_DEMO_PREFIX + "%"}
      `
    )[0].c;
    if (existing > 0) {
      console.log(
        `[seed-demo] tenant ${TARGET_TENANT_SLUG} already has ${existing} SEED-DEMO-* consignee(s).`,
      );
      console.log(
        `[seed-demo] Refusing to re-seed. To start over, manually delete SEED-DEMO-* rows + cascading addresses, rotations, crm_events, and FAILED tasks via Supabase SQL editor.`,
      );
      console.log(`[seed-demo] no-op exit.`);
      return;
    }

    // 3. Plan summary.
    const today = new Date().toISOString().slice(0, 10);
    const sarahSubStart = offsetDays(today, SARAH.subscriptionStartDateOffset);
    const failedDates = SARAH.failedTasks.map((t) => offsetDays(today, t.offsetDays));

    console.log(`[seed-demo] plan:`);
    console.log(`  - tenant:                ${tenant.slug} (${tenant.suitefleet_customer_code})`);
    console.log(`  - today:                 ${today}`);
    console.log(`  - Fatima:`);
    console.log(`      name:                ${FATIMA.name}`);
    console.log(`      phone/email:         ${FATIMA.phone} / ${FATIMA.email}`);
    console.log(`      home address:        ${FATIMA.homeAddress.line} (${FATIMA.homeAddress.district}, ${FATIMA.homeAddress.emirate})`);
    console.log(`      office address:      ${FATIMA.officeAddress.line} (${FATIMA.officeAddress.district}, ${FATIMA.officeAddress.emirate})`);
    console.log(`      meal plan:           ${FATIMA.mealPlanName}`);
    console.log(`      cadence:             Mon-Fri ${FATIMA.deliveryWindowStart}-${FATIMA.deliveryWindowEnd} Asia/Dubai`);
    console.log(`      rotation:            Mon=home, Tue=office, Wed=home, Thu=office, Fri=home`);
    console.log(`      sub start_date:      ${today}`);
    console.log(`  - Sarah:`);
    console.log(`      name:                ${SARAH.name}`);
    console.log(`      phone/email:         ${SARAH.phone} / ${SARAH.email}`);
    console.log(`      home address:        ${SARAH.homeAddress.line} (${SARAH.homeAddress.district}, ${SARAH.homeAddress.emirate})`);
    console.log(`      meal plan:           ${SARAH.mealPlanName}`);
    console.log(`      cadence:             Mon-Fri ${SARAH.deliveryWindowStart}-${SARAH.deliveryWindowEnd} Asia/Dubai`);
    console.log(`      crm_state:           ACTIVE (demo elevates HIGH_RISK live per Q1)`);
    console.log(`      sub start_date:      ${sarahSubStart} (today ${SARAH.subscriptionStartDateOffset} days)`);
    console.log(`      failed tasks:`);
    SARAH.failedTasks.forEach((t, i) => {
      console.log(
        `        [${i + 1}] ${failedDates[i]}  ${t.customerOrderNumber}  "${t.failureReasonComment}"`,
      );
    });

    if (!confirmed) {
      console.log("");
      console.log(`[seed-demo] dry run — no changes made.`);
      console.log(`[seed-demo] re-run with --yes=true to actually seed.`);
      return;
    }

    // 4. Single transaction — atomic across both personas.
    await sql.begin(async (tx) => {
      // 4a. Fatima — consignee.
      const [fatimaConsignee] = await tx`
        INSERT INTO consignees (
          tenant_id, name, phone, email,
          address_line, emirate_or_region, district, external_ref
        ) VALUES (
          ${tenant.id},
          ${FATIMA.name},
          ${FATIMA.phone},
          ${FATIMA.email},
          ${FATIMA.homeAddress.line},
          ${FATIMA.homeAddress.emirate},
          ${FATIMA.homeAddress.district},
          ${FATIMA.consigneeExternalRef}
        )
        RETURNING id
      `;

      // 4b. Fatima — 2 addresses (home primary, office).
      const fatimaAddrs = await tx`
        INSERT INTO addresses (
          consignee_id, tenant_id, label, is_primary, line, district, emirate
        ) VALUES
          (${fatimaConsignee.id}, ${tenant.id}, 'home', true,
           ${FATIMA.homeAddress.line}, ${FATIMA.homeAddress.district}, ${FATIMA.homeAddress.emirate}),
          (${fatimaConsignee.id}, ${tenant.id}, 'office', false,
           ${FATIMA.officeAddress.line}, ${FATIMA.officeAddress.district}, ${FATIMA.officeAddress.emirate})
        RETURNING id, label
      `;
      const fatimaHomeAddrId = fatimaAddrs.find((r) => r.label === "home").id;
      const fatimaOfficeAddrId = fatimaAddrs.find((r) => r.label === "office").id;

      // 4c. Fatima — subscription.
      const [fatimaSub] = await tx`
        INSERT INTO subscriptions (
          tenant_id, consignee_id, status, start_date, days_of_week,
          delivery_window_start, delivery_window_end, meal_plan_name, external_ref
        ) VALUES (
          ${tenant.id},
          ${fatimaConsignee.id},
          'active',
          ${today},
          ${FATIMA.daysOfWeek},
          ${FATIMA.deliveryWindowStart},
          ${FATIMA.deliveryWindowEnd},
          ${FATIMA.mealPlanName},
          ${FATIMA.subscriptionExternalRef}
        )
        RETURNING id
      `;

      // 4d. Fatima — 5 weekday rotations.
      const rotationRows = Object.entries(FATIMA.rotation).map(
        ([weekdayStr, label]) => {
          const weekday = parseInt(weekdayStr, 10);
          const addressId = label === "home" ? fatimaHomeAddrId : fatimaOfficeAddrId;
          return [fatimaSub.id, tenant.id, weekday, addressId];
        },
      );
      await tx`
        INSERT INTO subscription_address_rotations (
          subscription_id, tenant_id, weekday, address_id
        )
        VALUES ${tx(rotationRows)}
      `;

      // 5a. Sarah — consignee (crm_state defaults to 'ACTIVE' per Q1).
      const [sarahConsignee] = await tx`
        INSERT INTO consignees (
          tenant_id, name, phone, email,
          address_line, emirate_or_region, district, external_ref
        ) VALUES (
          ${tenant.id},
          ${SARAH.name},
          ${SARAH.phone},
          ${SARAH.email},
          ${SARAH.homeAddress.line},
          ${SARAH.homeAddress.emirate},
          ${SARAH.homeAddress.district},
          ${SARAH.consigneeExternalRef}
        )
        RETURNING id
      `;

      // 5b. Sarah — 1 home address (primary).
      const [sarahHomeAddr] = await tx`
        INSERT INTO addresses (
          consignee_id, tenant_id, label, is_primary, line, district, emirate
        ) VALUES (
          ${sarahConsignee.id}, ${tenant.id}, 'home', true,
          ${SARAH.homeAddress.line}, ${SARAH.homeAddress.district}, ${SARAH.homeAddress.emirate}
        )
        RETURNING id
      `;

      // 5c. Sarah — subscription with backdated start_date (Q7).
      const [sarahSub] = await tx`
        INSERT INTO subscriptions (
          tenant_id, consignee_id, status, start_date, days_of_week,
          delivery_window_start, delivery_window_end, meal_plan_name, external_ref
        ) VALUES (
          ${tenant.id},
          ${sarahConsignee.id},
          'active',
          ${sarahSubStart},
          ${SARAH.daysOfWeek},
          ${SARAH.deliveryWindowStart},
          ${SARAH.deliveryWindowEnd},
          ${SARAH.mealPlanName},
          ${SARAH.subscriptionExternalRef}
        )
        RETURNING id
      `;

      // 5d. Sarah — 3 backdated FAILED tasks.
      // created_at + updated_at backdated to the failure timestamp; failure
      // happens shortly after the delivery window closes (14:00 Dubai = 10:00
      // UTC; 11:00 UTC reads as ~3pm Dubai post-window).
      for (const failedTask of SARAH.failedTasks) {
        const deliveryDate = offsetDays(today, failedTask.offsetDays);
        const failureTimestamp = `${deliveryDate}T11:00:00.000Z`;
        await tx`
          INSERT INTO tasks (
            tenant_id, consignee_id, subscription_id, address_id,
            created_via, customer_order_number, internal_status,
            delivery_date, delivery_start_time, delivery_end_time,
            delivery_type, task_kind, failure_reason_comment,
            created_at, updated_at
          ) VALUES (
            ${tenant.id},
            ${sarahConsignee.id},
            ${sarahSub.id},
            ${sarahHomeAddr.id},
            'subscription',
            ${failedTask.customerOrderNumber},
            'FAILED',
            ${deliveryDate},
            ${SARAH.deliveryWindowStart},
            ${SARAH.deliveryWindowEnd},
            'STANDARD',
            'DELIVERY',
            ${failedTask.failureReasonComment},
            ${failureTimestamp},
            ${failureTimestamp}
          )
        `;
      }

      // 6. Operator hand-off — surface IDs for verification.
      console.log("");
      console.log("─".repeat(72));
      console.log(`Demo persona seeding complete — ${tenant.name}`);
      console.log("─".repeat(72));
      console.log(`Tenant id:           ${tenant.id}`);
      console.log(`Fatima consignee:    ${fatimaConsignee.id}`);
      console.log(`Fatima home addr:    ${fatimaHomeAddrId}`);
      console.log(`Fatima office addr:  ${fatimaOfficeAddrId}`);
      console.log(`Fatima subscription: ${fatimaSub.id}`);
      console.log(`Sarah consignee:     ${sarahConsignee.id}`);
      console.log(`Sarah home addr:     ${sarahHomeAddr.id}`);
      console.log(`Sarah subscription:  ${sarahSub.id}`);
      console.log(`Sarah FAILED tasks:  ${SARAH.failedTasks.length} (delivery_dates: ${failedDates.join(", ")})`);
      console.log("─".repeat(72));
      console.log(`Brief §5.3 gate 7 (Fatima rotation):  satisfied`);
      console.log(`Brief §5.3 gate 8 (Sarah ≥2 fails):   satisfied (3 failed)`);
      console.log(`Brief §5.3 gate 5 (DELIVERED+POD):    NOT this script (gates on Session A's A2 production smoke output)`);
      console.log("─".repeat(72));
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
