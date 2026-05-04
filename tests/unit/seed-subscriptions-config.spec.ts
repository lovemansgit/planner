// Day 11 / P3 — pure config-validation tests for the seed-subscriptions
// CLI's MERCHANT_PROFILES catalogue. The script itself is operator-run
// and not part of CI; these tests pin the static config so a future
// edit can't silently introduce volume drift, region-distribution
// errors, or schema-incompatible values.

import { describe, expect, it } from "vitest";

import {
  MERCHANT_PROFILES,
  SEED_EXTERNAL_REF_PREFIX,
  mealPlanForIndex,
  regionForIndex,
  syntheticAddressLine,
  syntheticExternalRef,
  syntheticName,
  syntheticPhone,
} from "../../scripts/seed-subscriptions-config.mjs";

const EXPECTED_MERCHANTS = ["meal-plan-scheduler", "dr-nutrition", "fresh-butchers"];

describe("MERCHANT_PROFILES — catalogue completeness", () => {
  it("includes the 3 P3 MVP merchants", () => {
    expect(Object.keys(MERCHANT_PROFILES).sort()).toEqual([...EXPECTED_MERCHANTS].sort());
  });

  it("locks Day-11-decision per-merchant volume targets (200 / 145 / 500)", () => {
    expect(MERCHANT_PROFILES["meal-plan-scheduler"].consigneeCount).toBe(200);
    expect(MERCHANT_PROFILES["dr-nutrition"].consigneeCount).toBe(145);
    expect(MERCHANT_PROFILES["fresh-butchers"].consigneeCount).toBe(500);
  });

  it("region distributions sum to consigneeCount per merchant", () => {
    for (const slug of EXPECTED_MERCHANTS) {
      const p = MERCHANT_PROFILES[slug];
      const regionsSum = p.regions.reduce((acc, r) => acc + r.count, 0);
      expect(regionsSum, `regions sum for ${slug}`).toBe(p.consigneeCount);
    }
  });
});

describe("MERCHANT_PROFILES — schema-compat invariants", () => {
  it("daysOfWeek values are ISO 1-7 (matches subscriptions_days_of_week_iso_domain CHECK)", () => {
    for (const slug of EXPECTED_MERCHANTS) {
      const p = MERCHANT_PROFILES[slug];
      expect(p.daysOfWeek.length).toBeGreaterThanOrEqual(1);
      expect(p.daysOfWeek.length).toBeLessThanOrEqual(7);
      for (const d of p.daysOfWeek) {
        expect(d).toBeGreaterThanOrEqual(1);
        expect(d).toBeLessThanOrEqual(7);
      }
    }
  });

  it("delivery window start strictly precedes end (matches subscriptions_delivery_window_strict CHECK)", () => {
    for (const slug of EXPECTED_MERCHANTS) {
      const p = MERCHANT_PROFILES[slug];
      expect(
        p.deliveryWindowStart < p.deliveryWindowEnd,
        `${slug} window start < end`,
      ).toBe(true);
    }
  });

  it("locked Day-11 cadence per merchant (MPL weekday 5-day, DNR daily 7-day, FBU Tue/Fri 2-day)", () => {
    expect(MERCHANT_PROFILES["meal-plan-scheduler"].daysOfWeek).toEqual([1, 2, 3, 4, 5]);
    expect(MERCHANT_PROFILES["dr-nutrition"].daysOfWeek).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(MERCHANT_PROFILES["fresh-butchers"].daysOfWeek).toEqual([2, 5]);
  });
});

describe("regionForIndex", () => {
  const mpl = MERCHANT_PROFILES["meal-plan-scheduler"];

  it("places index 1 in the first region bucket", () => {
    expect(regionForIndex(mpl, 1)).toEqual({ region: "Dubai", district: "Al Barsha" });
  });

  it("places the boundary index in the correct bucket (cumulative count)", () => {
    // MPL: Al Barsha 70 + Jumeirah 60 + Business Bay 70 = 200
    expect(regionForIndex(mpl, 70)).toEqual({ region: "Dubai", district: "Al Barsha" });
    expect(regionForIndex(mpl, 71)).toEqual({ region: "Dubai", district: "Jumeirah" });
    expect(regionForIndex(mpl, 130)).toEqual({ region: "Dubai", district: "Jumeirah" });
    expect(regionForIndex(mpl, 131)).toEqual({ region: "Dubai", district: "Business Bay" });
    expect(regionForIndex(mpl, 200)).toEqual({ region: "Dubai", district: "Business Bay" });
  });

  it("throws on out-of-range index", () => {
    expect(() => regionForIndex(mpl, 0)).toThrow();
    expect(() => regionForIndex(mpl, 201)).toThrow();
  });
});

describe("synthetic identifier helpers — deterministic + unique", () => {
  it("phone numbers use distinct UAE mobile prefix per merchant", () => {
    expect(syntheticPhone("MPL", 1)).toMatch(/^\+9715[0-9]/);
    expect(syntheticPhone("DNR", 1)).toMatch(/^\+9715[0-9]/);
    expect(syntheticPhone("FBU", 1)).toMatch(/^\+9715[0-9]/);
    // Distinct prefixes — no cross-merchant phone collisions.
    expect(syntheticPhone("MPL", 1).slice(0, 7)).not.toBe(
      syntheticPhone("DNR", 1).slice(0, 7),
    );
    expect(syntheticPhone("DNR", 1).slice(0, 7)).not.toBe(
      syntheticPhone("FBU", 1).slice(0, 7),
    );
  });

  it("phone numbers are deterministic per (merchant, index)", () => {
    expect(syntheticPhone("MPL", 42)).toBe(syntheticPhone("MPL", 42));
  });

  it("external_ref carries the SEED- sentinel (drives idempotency pre-check)", () => {
    const ref = syntheticExternalRef("CON", "MPL", 1);
    expect(ref.startsWith(SEED_EXTERNAL_REF_PREFIX)).toBe(true);
    expect(ref).toBe("SEED-MPL-CON-0001");
  });

  it("external_ref distinguishes consignee from subscription", () => {
    expect(syntheticExternalRef("CON", "DNR", 5)).toBe("SEED-DNR-CON-0005");
    expect(syntheticExternalRef("SUB", "DNR", 5)).toBe("SEED-DNR-SUB-0005");
  });

  it("rejects unknown kind tokens", () => {
    // Runtime check for invalid kind — the function guards against
    // typo'd callers regardless of compile-time typing.
    expect(() => (syntheticExternalRef as (k: string, m: string, i: number) => string)("FOO", "MPL", 1)).toThrow();
  });

  it("synthetic name + address are stable per (merchant, index)", () => {
    expect(syntheticName("MPL", 7)).toBe("MPL Customer 0007");
    const mpl = MERCHANT_PROFILES["meal-plan-scheduler"];
    const addr = syntheticAddressLine(mpl, 1);
    expect(addr).toBe("Building 0001, Al Barsha, Dubai");
  });
});

describe("mealPlanForIndex — cycles through the catalogue", () => {
  it("rotates through the merchant's planNames by 1-based index", () => {
    const fbu = MERCHANT_PROFILES["fresh-butchers"];
    expect(mealPlanForIndex(fbu, 1)).toBe(fbu.mealPlanNames[0]);
    expect(mealPlanForIndex(fbu, 2)).toBe(fbu.mealPlanNames[1]);
    expect(mealPlanForIndex(fbu, fbu.mealPlanNames.length)).toBe(
      fbu.mealPlanNames[fbu.mealPlanNames.length - 1],
    );
    // Wraps cleanly.
    expect(mealPlanForIndex(fbu, fbu.mealPlanNames.length + 1)).toBe(fbu.mealPlanNames[0]);
  });
});
