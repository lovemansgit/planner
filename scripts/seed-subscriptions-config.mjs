// scripts/seed-subscriptions-config.mjs
//
// Day 11 / P3 — declarative per-merchant seeding profiles for the
// 3-merchant MVP demo (memory/plans/p3_subscription_seeding_plan.md).
//
// Volume target locked at cumulative-by-Day-14 per the Day-11 close
// brief: 1000 tasks per merchant accumulate over the pilot window
// (Days 12-14), NOT visible-on-Day-14 snapshot. Counts here are the
// per-merchant subscription totals; cron multiplies by daysOfWeek
// frequency for daily task generation.
//
// Keep this file pure data + small pure helpers — no DB calls, no env
// reads, no fs. Tested directly by tests/unit/seed-subscriptions-config.spec.ts.

/**
 * @typedef {Object} MerchantProfile
 * @property {string} slug                Tenant slug; matches onboard-merchant.mjs.
 * @property {string} merchantCode        Per-merchant short code; drives synthetic identifiers.
 * @property {number} consigneeCount      Total consignees (= subscription count; 1 sub per consignee in pilot).
 * @property {readonly { region: string, district: string, count: number }[]} regions
 *                                        Region/district/count distribution. Sum equals consigneeCount.
 * @property {readonly string[]} mealPlanNames  Plan archetype names cycled by index.
 * @property {readonly number[]} daysOfWeek     ISO 1-7 weekdays (Mon=1, Sun=7).
 * @property {string} deliveryWindowStart       HH:MM:SS Asia/Dubai.
 * @property {string} deliveryWindowEnd         HH:MM:SS Asia/Dubai; strictly later than start.
 * @property {string} description               Operator-visible memo about the merchant.
 */

/** @type {Readonly<Record<string, MerchantProfile>>} */
export const MERCHANT_PROFILES = Object.freeze({
  "meal-plan-scheduler": {
    slug: "meal-plan-scheduler",
    merchantCode: "MPL",
    consigneeCount: 200,
    regions: [
      { region: "Dubai", district: "Al Barsha", count: 70 },
      { region: "Dubai", district: "Jumeirah", count: 60 },
      { region: "Dubai", district: "Business Bay", count: 70 },
    ],
    mealPlanNames: [
      "5-day veggie box",
      "Weekday plant plan",
      "Green starter",
      "Vegan reset",
    ],
    daysOfWeek: [1, 2, 3, 4, 5],
    deliveryWindowStart: "12:00:00",
    deliveryWindowEnd: "14:00:00",
    description: "Vegetarian and vegan meal plans, weekday lunch delivery in Dubai.",
  },
  "dr-nutrition": {
    slug: "dr-nutrition",
    merchantCode: "DNR",
    consigneeCount: 145,
    regions: [
      { region: "Dubai", district: "Downtown Dubai", count: 60 },
      { region: "Dubai", district: "Dubai Marina", count: 40 },
      { region: "Sharjah", district: "Al Majaz", count: 25 },
      { region: "Sharjah", district: "Al Nahda", count: 20 },
    ],
    mealPlanNames: [
      "Diabetic-friendly daily",
      "Low-sodium plan",
      "Weight-management protocol",
      "Post-op recovery box",
    ],
    daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    deliveryWindowStart: "07:00:00",
    deliveryWindowEnd: "09:00:00",
    description: "Medical and diet-controlled plans, daily morning delivery across Dubai and Sharjah.",
  },
  "fresh-butchers": {
    slug: "fresh-butchers",
    merchantCode: "FBU",
    consigneeCount: 500,
    regions: [
      { region: "Dubai", district: "Deira", count: 200 },
      { region: "Dubai", district: "Al Karama", count: 150 },
      { region: "Abu Dhabi", district: "Al Khalidiyah", count: 90 },
      { region: "Abu Dhabi", district: "Al Reem Island", count: 60 },
    ],
    mealPlanNames: [
      "Weekly grass-fed box",
      "Family BBQ plan",
      "Twice-weekly meat assortment",
      "Premium cuts",
    ],
    daysOfWeek: [2, 5],
    deliveryWindowStart: "17:00:00",
    deliveryWindowEnd: "19:00:00",
    description: "Butcher subscriptions, twice-weekly evening delivery across Dubai and Abu Dhabi.",
  },
});

/** Sentinel embedded in every seeded row's external_ref so the pre-check can detect prior seedings. */
export const SEED_EXTERNAL_REF_PREFIX = "SEED-";

/**
 * Deterministic UAE mobile-prefix phone for a per-merchant consignee
 * index. Per-merchant prefix avoids cross-merchant phone collisions
 * between seeded rows; the (tenant_id, phone) index supports advisory
 * dedup later if real merchant data lands alongside.
 *
 * MPL → +97150…, DNR → +97152…, FBU → +97154…
 */
export function syntheticPhone(merchantCode, index) {
  const prefix = MERCHANT_PHONE_PREFIX[merchantCode];
  if (!prefix) {
    throw new Error(`unknown merchantCode: ${merchantCode}`);
  }
  const padded = String(index).padStart(7, "0");
  return `${prefix}${padded}`;
}

const MERCHANT_PHONE_PREFIX = Object.freeze({
  MPL: "+971500",
  DNR: "+971520",
  FBU: "+971540",
});

/**
 * external_ref shape for seeded consignees + subscriptions:
 *   SEED-{merchantCode}-CON-{0001..N}
 *   SEED-{merchantCode}-SUB-{0001..N}
 *
 * The SEED- prefix is what the pre-execution check greps for (LIKE
 * 'SEED-%'). The {merchantCode}- segment scopes per-merchant so a
 * re-seed of one merchant doesn't trip on another's seeded rows.
 */
export function syntheticExternalRef(kind, merchantCode, index) {
  if (kind !== "CON" && kind !== "SUB") {
    throw new Error(`syntheticExternalRef kind must be CON or SUB, got: ${kind}`);
  }
  const padded = String(index).padStart(4, "0");
  return `${SEED_EXTERNAL_REF_PREFIX}${merchantCode}-${kind}-${padded}`;
}

/**
 * Resolve which (region, district) bucket a 1-based consignee index
 * falls into per the merchant's distribution. Iterates the regions
 * array in declared order; the cumulative count puts the index into
 * exactly one bucket.
 *
 * Throws when the index is out of [1, consigneeCount].
 */
export function regionForIndex(profile, index) {
  if (index < 1 || index > profile.consigneeCount) {
    throw new Error(
      `index ${index} out of range [1, ${profile.consigneeCount}] for ${profile.merchantCode}`,
    );
  }
  let cumulative = 0;
  for (const r of profile.regions) {
    cumulative += r.count;
    if (index <= cumulative) {
      return { region: r.region, district: r.district };
    }
  }
  // Unreachable when consigneeCount equals sum(regions.count) — the
  // catalogue invariant test pins that.
  throw new Error(`region distribution does not sum to consigneeCount for ${profile.merchantCode}`);
}

export function mealPlanForIndex(profile, index) {
  const i = (index - 1) % profile.mealPlanNames.length;
  return profile.mealPlanNames[i];
}

/**
 * Synthetic operator-visible name. Numbered for legibility — operators
 * scanning the consignees list see Customer 0001, 0002, etc., which is
 * obviously seed data without leaking real PII.
 */
export function syntheticName(merchantCode, index) {
  const padded = String(index).padStart(4, "0");
  return `${merchantCode} Customer ${padded}`;
}

export function syntheticAddressLine(profile, index) {
  // Pseudo-deterministic but stable per (merchant, index) so re-runs
  // produce identical fixtures. No real-place believability beyond the
  // emirate / district label — these are seed rows, not pretending to
  // be real customers.
  const padded = String(index).padStart(4, "0");
  const r = regionForIndex(profile, index);
  return `Building ${padded}, ${r.district}, ${r.region}`;
}
