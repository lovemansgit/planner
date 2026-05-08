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
  it("accepts exactly 3 lowercase a-z letters", () => {
    expect(validateSlug("abc")).toBe(true);
    expect(validateSlug("xyz")).toBe(true);
    expect(validateSlug("dmb")).toBe(true);
  });

  it("rejects wrong length", () => {
    expect(validateSlug("ab")).toBe(false);
    expect(validateSlug("abcd")).toBe(false);
    expect(validateSlug("")).toBe(false);
  });

  it("rejects non-lowercase or non-letter chars", () => {
    expect(validateSlug("ABC")).toBe(false);
    expect(validateSlug("abC")).toBe(false);
    expect(validateSlug("a1c")).toBe(false);
    expect(validateSlug("a-c")).toBe(false);
    expect(validateSlug("ab ")).toBe(false);
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
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("Demo Bistro");
      expect(result.value.slug).toBe("dmb");
      expect(result.value.line).toBe("Building 4, Sheikh Zayed Road");
      expect(result.value.district).toBe("Al Quoz");
      expect(result.value.emirate).toBe("Dubai");
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

  it("rejects non-conforming slugs even when length normalised", () => {
    const result = parseCreateMerchantForm(
      makeForm({
        name: "Demo Bistro",
        slug: "abcd",
        pickup_line: "x",
        pickup_district: "x",
        pickup_emirate: "x",
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.slug).toMatch(/3 lowercase letters/);
    }
  });

  it("accepts uppercase slug input by normalising before validating", () => {
    const result = parseCreateMerchantForm(
      makeForm({
        name: "Demo Bistro",
        slug: "DMB",
        pickup_line: "x",
        pickup_district: "x",
        pickup_emirate: "x",
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.slug).toBe("dmb");
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
