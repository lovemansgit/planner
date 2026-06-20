// F8 (20 Jun 2026) — genuine-merchant default-view contract.
//
// Love's ruling: the admin merchant list shows ONLY genuine merchants
// by default; the ~1,825 automated-test tenants are hidden (not
// deleted), reversible via the "show all" toggle.
//
// These tests are the executable specification of the predicate. They
// run in JS against real slug strings — NO database — deliberately:
// a real-DB integration test would INSERT test tenants into the single
// production Supabase, and the `audit_events_no_delete` rule blocks
// teardown, so the rows would persist. That is the exact pollution
// this feature exists to hide. The SQL rendering of the same contract
// is asserted in repository.spec.ts; both consume the shared
// constants exported here.

import { describe, expect, it } from "vitest";

import {
  GENUINE_MERCHANT_SLUGS,
  isGenuineMerchant,
} from "../genuine-merchants";

// The six genuine merchants confirmed by the 20 Jun 2026 read-only
// diagnosis (all six were `active` in production at diagnosis time).
const GENUINE = [
  "meal-plan-scheduler",
  "dr-nutrition",
  "fresh-butchers",
  "transcorp",
  "hem",
  "mlp",
];

// Real automated-test slugs sampled from the production diagnosis —
// each carries the random 8-hex isolation fragment mid-slug.
const TEST_SLUGS = [
  "r3-test-74a6b577-a",
  "det-db4cd52c-full",
  "t1-trigger-1715c47c-b",
  "churn-09f782ed",
];

describe("isGenuineMerchant (F8 default-view contract)", () => {
  it("shows all six genuine merchants (active)", () => {
    for (const slug of GENUINE) {
      expect(isGenuineMerchant({ slug, status: "active" })).toBe(true);
    }
  });

  it("exports exactly the six genuine slugs as the allowlist safety net", () => {
    expect([...GENUINE_MERCHANT_SLUGS].sort()).toEqual([...GENUINE].sort());
  });

  it("shows an allowlisted merchant even when provisioning (safety net wins over status)", () => {
    // Guarantees a real merchant never disappears from the default
    // view, regardless of lifecycle state.
    expect(isGenuineMerchant({ slug: "transcorp", status: "provisioning" })).toBe(true);
    expect(isGenuineMerchant({ slug: "mlp", status: "archived" })).toBe(true);
  });

  it("hides automated-test tenants (random 8-hex slug fragment), regardless of status", () => {
    for (const slug of TEST_SLUGS) {
      expect(isGenuineMerchant({ slug, status: "active" })).toBe(false);
      expect(isGenuineMerchant({ slug, status: "provisioning" })).toBe(false);
    }
  });

  it("shows a non-allowlisted real merchant with a clean slug (active/inactive/suspended)", () => {
    expect(isGenuineMerchant({ slug: "acme-foods", status: "active" })).toBe(true);
    expect(isGenuineMerchant({ slug: "acme-foods", status: "inactive" })).toBe(true);
    expect(isGenuineMerchant({ slug: "acme-foods", status: "suspended" })).toBe(true);
  });

  it("hides provisioning + archived non-allowlisted rows from the default view", () => {
    expect(isGenuineMerchant({ slug: "acme-foods", status: "provisioning" })).toBe(false);
    expect(isGenuineMerchant({ slug: "acme-foods", status: "archived" })).toBe(false);
  });
});
