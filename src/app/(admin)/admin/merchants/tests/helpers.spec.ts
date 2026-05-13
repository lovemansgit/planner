// Day 18 / C1 — Pure-helper unit tests for the merchant admin frontend.
//
// Helper-only coverage per the deferred client-component test infra
// memo (memory/followup_client_component_test_infra.md). DOM-side
// interaction (modal click-outside, Escape, focus return) is covered
// in a future PR establishing client-component test infrastructure.

import { describe, expect, it } from "vitest";

import {
  normaliseSlug,
  parseCreateMerchantForm,
  parseEditMerchantForm,
  statusAction,
  statusBadgeSurface,
  validateSlug,
} from "../_helpers";

describe("normaliseSlug", () => {
  it("trims surrounding whitespace", () => {
    expect(normaliseSlug("  abc  ")).toBe("abc");
  });

  it("lowercases input", () => {
    expect(normaliseSlug("ABC")).toBe("abc");
  });

  it("does not strip non-letter chars (preserves operator intent for downstream rejection)", () => {
    // Stripping silently would surprise the operator. validateSlug
    // returns false for these; the form surfaces the rejection.
    expect(normaliseSlug("a-b")).toBe("a-b");
    expect(normaliseSlug("a1c")).toBe("a1c");
    expect(normaliseSlug("abcd")).toBe("abcd");
  });
});

describe("validateSlug", () => {
  // Mirrors the shipped service-layer SLUG_RE at
  // src/modules/merchants/service.ts:103-110:
  //   /^[a-z0-9-]+$/ with length cap 60.
  // §A registered-metadata-wins.

  it("accepts lowercase letters, digits, and hyphens", () => {
    expect(validateSlug("xyz")).toBe(true);
    expect(validateSlug("demo-bistro")).toBe(true);
    expect(validateSlug("dmb01")).toBe(true);
    expect(validateSlug("a1-b2-c3")).toBe(true);
  });

  it("accepts the 1-character lower-bound length", () => {
    expect(validateSlug("a")).toBe(true);
    expect(validateSlug("0")).toBe(true);
  });

  it("accepts the 60-character upper-bound length", () => {
    expect(validateSlug("a".repeat(60))).toBe(true);
  });

  it("rejects empty string (regex `+` quantifier requires ≥1 char)", () => {
    expect(validateSlug("")).toBe(false);
  });

  it("rejects strings longer than 60 characters", () => {
    expect(validateSlug("a".repeat(61))).toBe(false);
    expect(validateSlug("a".repeat(100))).toBe(false);
  });

  it("rejects uppercase chars", () => {
    expect(validateSlug("ABC")).toBe(false);
    expect(validateSlug("Demo-Bistro")).toBe(false);
    expect(validateSlug("abC")).toBe(false);
  });

  it("rejects whitespace, underscores, and other punctuation", () => {
    expect(validateSlug("demo bistro")).toBe(false);
    expect(validateSlug("demo_bistro")).toBe(false);
    expect(validateSlug("demo.bistro")).toBe(false);
    expect(validateSlug("demo/bistro")).toBe(false);
    expect(validateSlug("demo,bistro")).toBe(false);
  });
});

describe("statusBadgeSurface", () => {
  it("active uses Grass Green (positive go-signal)", () => {
    const surface = statusBadgeSurface("active");
    expect(surface.label).toBe("Active");
    expect(surface.className).toContain("text-green");
  });

  it("provisioning, suspended, inactive are muted (no go-signal)", () => {
    expect(statusBadgeSurface("provisioning").label).toBe("Provisioning");
    expect(statusBadgeSurface("provisioning").className).not.toContain("text-green");
    expect(statusBadgeSurface("suspended").label).toBe("Suspended");
    expect(statusBadgeSurface("suspended").className).not.toContain("text-green");
    expect(statusBadgeSurface("inactive").label).toBe("Inactive");
    expect(statusBadgeSurface("inactive").className).not.toContain("text-green");
  });

  it("archived renders as muted neutral (Day-18 cleanup; reachable only via ?status=archived)", () => {
    const surface = statusBadgeSurface("archived");
    expect(surface.label).toBe("Archived");
    // No go-signal — same neutral posture as inactive (row not in
    // operator scope). Uses the muted-tertiary text-color token.
    expect(surface.className).not.toContain("text-green");
    expect(surface.className).toContain("color-text-tertiary");
  });
});

describe("statusAction", () => {
  it("provisioning offers activate", () => {
    expect(statusAction("provisioning")).toBe("activate");
  });

  it("active offers deactivate", () => {
    expect(statusAction("active")).toBe("deactivate");
  });

  it("suspended and inactive offer no MVP action", () => {
    // Phase-2 transitions per
    // memory/followup_merchant_lifecycle_transition_expansion.md.
    expect(statusAction("suspended")).toBeNull();
    expect(statusAction("inactive")).toBeNull();
  });

  it("archived offers no MVP action (Day-18 cleanup; archive is migration-only, no operator path)", () => {
    expect(statusAction("archived")).toBeNull();
  });
});

describe("parseCreateMerchantForm", () => {
  function makeForm(values: Record<string, string>): FormData {
    const fd = new FormData();
    for (const [k, v] of Object.entries(values)) fd.set(k, v);
    return fd;
  }

  it("returns ok=true with normalised values for valid input", () => {
    const result = parseCreateMerchantForm(
      makeForm({
        name: "  Demo Bistro ",
        slug: " DMB ",
        pickup_line: "Building 4, Sheikh Zayed Road",
        pickup_district: "Al Quoz",
        pickup_emirate: "Dubai",
        suitefleet_customer_code: "588",
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("Demo Bistro");
      expect(result.value.slug).toBe("dmb");
      expect(result.value.line).toBe("Building 4, Sheikh Zayed Road");
      expect(result.value.district).toBe("Al Quoz");
      expect(result.value.emirate).toBe("Dubai");
      expect(result.value.suitefleetCustomerCode).toBe("588");
    }
  });

  it("aggregates every field error in one pass (multi-error UX)", () => {
    const result = parseCreateMerchantForm(
      makeForm({
        name: "",
        slug: "",
        pickup_line: "",
        pickup_district: "",
        pickup_emirate: "",
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.name).toBeTruthy();
      expect(result.fieldErrors.slug).toBeTruthy();
      expect(result.fieldErrors.pickup_line).toBeTruthy();
      expect(result.fieldErrors.pickup_district).toBeTruthy();
      expect(result.fieldErrors.pickup_emirate).toBeTruthy();
    }
  });

  it("rejects slugs that fail the service-layer regex (e.g. underscores)", () => {
    const result = parseCreateMerchantForm(
      makeForm({
        name: "Demo Bistro",
        slug: "demo_bistro",
        pickup_line: "x",
        pickup_district: "x",
        pickup_emirate: "x",
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.slug).toMatch(/lowercase letters, numbers, and hyphens/);
    }
  });

  it("rejects slugs longer than 60 characters", () => {
    const result = parseCreateMerchantForm(
      makeForm({
        name: "Demo Bistro",
        slug: "a".repeat(61),
        pickup_line: "x",
        pickup_district: "x",
        pickup_emirate: "x",
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.slug).toMatch(/1-60 characters/);
    }
  });

  it("accepts uppercase slug input by normalising before validating", () => {
    const result = parseCreateMerchantForm(
      makeForm({
        name: "Demo Bistro",
        slug: "DEMO-Bistro",
        pickup_line: "x",
        pickup_district: "x",
        pickup_emirate: "x",
        suitefleet_customer_code: "588",
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.slug).toBe("demo-bistro");
  });

  // ---------------------------------------------------------------------------
  // Day-22 §5.3 Gate 2 closure — SF customer code field validation
  // ---------------------------------------------------------------------------

  it("rejects missing suitefleet_customer_code with field error", () => {
    const result = parseCreateMerchantForm(
      makeForm({
        name: "Demo Bistro",
        slug: "demo-bistro",
        pickup_line: "x",
        pickup_district: "x",
        pickup_emirate: "x",
        // suitefleet_customer_code intentionally omitted
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.suitefleet_customer_code).toMatch(/required/i);
    }
  });

  it("rejects empty / whitespace suitefleet_customer_code", () => {
    const result = parseCreateMerchantForm(
      makeForm({
        name: "Demo Bistro",
        slug: "demo-bistro",
        pickup_line: "x",
        pickup_district: "x",
        pickup_emirate: "x",
        suitefleet_customer_code: "   ",
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.suitefleet_customer_code).toMatch(/required/i);
    }
  });

  it("rejects non-numeric suitefleet_customer_code", () => {
    const result = parseCreateMerchantForm(
      makeForm({
        name: "Demo Bistro",
        slug: "demo-bistro",
        pickup_line: "x",
        pickup_district: "x",
        pickup_emirate: "x",
        suitefleet_customer_code: "abc",
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.suitefleet_customer_code).toMatch(/positive integer/i);
    }
  });

  it("rejects suitefleet_customer_code with leading zero", () => {
    const result = parseCreateMerchantForm(
      makeForm({
        name: "Demo Bistro",
        slug: "demo-bistro",
        pickup_line: "x",
        pickup_district: "x",
        pickup_emirate: "x",
        suitefleet_customer_code: "0588",
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.suitefleet_customer_code).toMatch(/positive integer/i);
    }
  });

  it("rejects bare zero suitefleet_customer_code", () => {
    const result = parseCreateMerchantForm(
      makeForm({
        name: "Demo Bistro",
        slug: "demo-bistro",
        pickup_line: "x",
        pickup_district: "x",
        pickup_emirate: "x",
        suitefleet_customer_code: "0",
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.suitefleet_customer_code).toMatch(/positive integer/i);
    }
  });

  it("accepts valid suitefleet_customer_code (positive integer)", () => {
    const result = parseCreateMerchantForm(
      makeForm({
        name: "Demo Bistro",
        slug: "demo-bistro",
        pickup_line: "x",
        pickup_district: "x",
        pickup_emirate: "x",
        suitefleet_customer_code: "588",
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.suitefleetCustomerCode).toBe("588");
    }
  });

  it("treats whitespace-only fields as missing", () => {
    const result = parseCreateMerchantForm(
      makeForm({
        name: "   ",
        slug: "abc",
        pickup_line: "   ",
        pickup_district: "x",
        pickup_emirate: "x",
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.name).toBeTruthy();
      expect(result.fieldErrors.pickup_line).toBeTruthy();
    }
  });
});

// -----------------------------------------------------------------------------
// parseEditMerchantForm (Day 25 / T3)
// -----------------------------------------------------------------------------

describe("parseEditMerchantForm", () => {
  function fd(values: Record<string, string>): FormData {
    const f = new FormData();
    for (const [k, v] of Object.entries(values)) f.set(k, v);
    return f;
  }

  function fullForm(overrides: Record<string, string> = {}): FormData {
    return fd({
      name: "Demo Bistro",
      slug: "demo-bistro",
      pickup_line: "Building 1, Al Quoz",
      pickup_district: "Al Quoz Industrial 1",
      pickup_emirate: "Dubai",
      suitefleet_customer_code: "588",
      ...overrides,
    });
  }

  it("happy path — all fields supplied returns pickupAddress nested object", () => {
    const result = parseEditMerchantForm(fullForm());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        name: "Demo Bistro",
        slug: "demo-bistro",
        pickupAddress: {
          line: "Building 1, Al Quoz",
          district: "Al Quoz Industrial 1",
          emirate: "Dubai",
        },
        suitefleetCustomerCode: "588",
      });
    }
  });

  it("trims surrounding whitespace on every field", () => {
    const result = parseEditMerchantForm(
      fullForm({
        name: "  Demo Bistro  ",
        slug: "  demo-bistro  ",
        pickup_line: "  Building 1  ",
        pickup_district: "  Al Quoz  ",
        pickup_emirate: "  Dubai  ",
        suitefleet_customer_code: "  588  ",
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("Demo Bistro");
      expect(result.value.slug).toBe("demo-bistro");
      expect(result.value.pickupAddress).toEqual({
        line: "Building 1",
        district: "Al Quoz",
        emirate: "Dubai",
      });
      expect(result.value.suitefleetCustomerCode).toBe("588");
    }
  });

  it("normalizes slug to lowercase", () => {
    const result = parseEditMerchantForm(fullForm({ slug: "Demo-Bistro" }));
    // normaliseSlug lowercases but does not strip; "demo-bistro" then
    // passes validateSlug.
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.slug).toBe("demo-bistro");
  });

  it("empty name returns field error", () => {
    const result = parseEditMerchantForm(fullForm({ name: "  " }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.name).toBeTruthy();
  });

  it("empty slug returns field error", () => {
    const result = parseEditMerchantForm(fullForm({ slug: "  " }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.slug).toBeTruthy();
  });

  it("invalid-char slug returns field error", () => {
    const result = parseEditMerchantForm(fullForm({ slug: "demo_bistro" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.slug).toBeTruthy();
  });

  it("over-60-char slug returns field error", () => {
    const result = parseEditMerchantForm(fullForm({ slug: "a".repeat(61) }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.slug).toBeTruthy();
  });

  it("empty suitefleet_customer_code returns field error", () => {
    const result = parseEditMerchantForm(fullForm({ suitefleet_customer_code: "" }));
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.fieldErrors.suitefleet_customer_code).toBeTruthy();
  });

  it("leading-zero suitefleet_customer_code returns field error", () => {
    const result = parseEditMerchantForm(
      fullForm({ suitefleet_customer_code: "0588" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.fieldErrors.suitefleet_customer_code).toBeTruthy();
  });

  it("non-numeric suitefleet_customer_code returns field error", () => {
    const result = parseEditMerchantForm(
      fullForm({ suitefleet_customer_code: "abc" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.fieldErrors.suitefleet_customer_code).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // Pickup-address all-or-none rule (plan §6.3)
  // -------------------------------------------------------------------------

  it("all-three-empty pickup → pickupAddress omitted from output (no-pickup-update intent)", () => {
    const result = parseEditMerchantForm(
      fullForm({ pickup_line: "", pickup_district: "", pickup_emirate: "" }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.pickupAddress).toBeUndefined();
    }
  });

  it("one-of-three pickup → field errors on the two empty sub-fields", () => {
    const result = parseEditMerchantForm(
      fullForm({ pickup_line: "filled", pickup_district: "", pickup_emirate: "" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.pickup_district).toBeTruthy();
      expect(result.fieldErrors.pickup_emirate).toBeTruthy();
      // The supplied sub-field is not flagged.
      expect(result.fieldErrors.pickup_line).toBeUndefined();
    }
  });

  it("two-of-three pickup → field error on the single empty sub-field", () => {
    const result = parseEditMerchantForm(
      fullForm({
        pickup_line: "filled",
        pickup_district: "filled",
        pickup_emirate: "",
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.pickup_emirate).toBeTruthy();
      expect(result.fieldErrors.pickup_line).toBeUndefined();
      expect(result.fieldErrors.pickup_district).toBeUndefined();
    }
  });

  it("whitespace-only pickup sub-field counts as empty (treated same as missing)", () => {
    // Common operator paste-noise. The all-or-none rule operates on
    // post-trim non-empty count.
    const result = parseEditMerchantForm(
      fullForm({
        pickup_line: "filled",
        pickup_district: "   ",
        pickup_emirate: "   ",
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.pickup_district).toBeTruthy();
      expect(result.fieldErrors.pickup_emirate).toBeTruthy();
    }
  });
});
