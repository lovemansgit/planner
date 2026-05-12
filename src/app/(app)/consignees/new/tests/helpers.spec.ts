// Day 22 / Phase 1 forms lane — onboard-consignee form parser tests.

import { describe, expect, it } from "vitest";

import { parseOnboardForm, validateStep } from "../_helpers";

function validForm(): FormData {
  const fd = new FormData();
  // Step 1
  fd.set("name", "Sarah Khouri");
  fd.set("phone", "+971501234567");
  fd.set("email", "sarah@example.com");
  // Step 2
  fd.set("address_label", "home");
  fd.set("address_line", "Building 4, Apt 12");
  fd.set("address_district", "Al Quoz");
  fd.set("address_emirate", "Dubai");
  // Step 3
  fd.set("subscription_start_date", "2026-05-04");
  fd.append("subscription_days_of_week", "mon");
  fd.append("subscription_days_of_week", "tue");
  fd.append("subscription_days_of_week", "wed");
  fd.append("subscription_days_of_week", "thu");
  fd.append("subscription_days_of_week", "fri");
  fd.set("subscription_delivery_window_start", "09:00");
  fd.set("subscription_delivery_window_end", "11:00");
  fd.set("subscription_meal_plan_name", "Breakfast");
  return fd;
}

describe("parseOnboardForm — happy path", () => {
  it("returns the structured wizard input", () => {
    const result = parseOnboardForm(validForm());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.consignee.name).toBe("Sarah Khouri");
    expect(result.value.consignee.phone).toBe("+971501234567");
    expect(result.value.primaryAddress.label).toBe("home");
    expect(result.value.subscription.daysOfWeek).toEqual([1, 2, 3, 4, 5]);
    expect(result.value.subscription.deliveryWindowStart).toBe("09:00:00");
  });
});

describe("parseOnboardForm — validation errors", () => {
  it("flags missing name", () => {
    const fd = validForm();
    fd.set("name", "");
    const result = parseOnboardForm(fd);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors.name).toBeDefined();
  });

  it("flags malformed phone", () => {
    const fd = validForm();
    fd.set("phone", "971501234567"); // missing +
    const result = parseOnboardForm(fd);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors.phone).toBeDefined();
  });

  it("flags malformed email", () => {
    const fd = validForm();
    fd.set("email", "notanemail");
    const result = parseOnboardForm(fd);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors.email).toBeDefined();
  });

  it("flags invalid address label", () => {
    const fd = validForm();
    fd.set("address_label", "warehouse");
    const result = parseOnboardForm(fd);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors.address_label).toBeDefined();
  });

  it("flags missing address line", () => {
    const fd = validForm();
    fd.set("address_line", "");
    const result = parseOnboardForm(fd);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors.address_line).toBeDefined();
  });

  it("flags malformed start date", () => {
    const fd = validForm();
    fd.set("subscription_start_date", "tomorrow");
    const result = parseOnboardForm(fd);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors.subscription_start_date).toBeDefined();
  });

  it("flags end_date <= start_date", () => {
    const fd = validForm();
    fd.set("subscription_start_date", "2026-05-10");
    fd.set("subscription_end_date", "2026-05-09");
    const result = parseOnboardForm(fd);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors.subscription_end_date).toMatch(/after/i);
  });

  it("flags empty weekday selection", () => {
    const fd = new FormData();
    // Re-create without weekdays
    fd.set("name", "S");
    fd.set("phone", "+971501234567");
    fd.set("address_label", "home");
    fd.set("address_line", "L");
    fd.set("address_district", "D");
    fd.set("address_emirate", "E");
    fd.set("subscription_start_date", "2026-05-04");
    fd.set("subscription_delivery_window_start", "09:00");
    fd.set("subscription_delivery_window_end", "11:00");
    const result = parseOnboardForm(fd);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors.subscription_days_of_week).toBeDefined();
  });

  it("flags window below 30-minute minimum", () => {
    const fd = validForm();
    fd.set("subscription_delivery_window_start", "09:00");
    fd.set("subscription_delivery_window_end", "09:20");
    const result = parseOnboardForm(fd);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors.subscription_delivery_window).toMatch(
      /at least 30/i,
    );
  });
});

// ---------------------------------------------------------------------------
// validateStep — Day-22 PM §3.22 per-step client-side validation
// ---------------------------------------------------------------------------
//
// The helper duplicates parseOnboardForm's per-step rules so the wizard
// can short-circuit forward navigation locally without a server-action
// roundtrip. Previously HTML5 `required` on fields inside `hidden`
// fieldsets was barred from constraint validation, so operators could
// click Continue through empty Step 1 / Step 2 fields.

describe("validateStep", () => {
  function makeFD(overrides: Record<string, string> = {}): FormData {
    const fd = new FormData();
    for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
    return fd;
  }

  describe("step 1 — identity", () => {
    it("passes when name + valid phone are present", () => {
      const fd = makeFD({ name: "Sarah Khouri", phone: "+971501234567" });
      expect(validateStep(1, fd)).toEqual({ ok: true });
    });

    it("rejects empty name", () => {
      const fd = makeFD({ name: "", phone: "+971501234567" });
      const result = validateStep(1, fd);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.fieldErrors.name).toMatch(/required/i);
    });

    it("rejects whitespace-only name", () => {
      const fd = makeFD({ name: "   ", phone: "+971501234567" });
      const result = validateStep(1, fd);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.fieldErrors.name).toMatch(/required/i);
    });

    it("rejects malformed phone (missing + prefix)", () => {
      const fd = makeFD({ name: "Sarah", phone: "971501234567" });
      const result = validateStep(1, fd);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.fieldErrors.phone).toMatch(/E\.164/);
    });

    it("rejects empty phone", () => {
      const fd = makeFD({ name: "Sarah", phone: "" });
      const result = validateStep(1, fd);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.fieldErrors.phone).toMatch(/required/i);
    });

    it("rejects email missing @ (when provided)", () => {
      const fd = makeFD({ name: "Sarah", phone: "+971501234567", email: "not-an-email" });
      const result = validateStep(1, fd);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.fieldErrors.email).toMatch(/@/);
    });

    it("passes when email is empty (optional)", () => {
      const fd = makeFD({ name: "Sarah", phone: "+971501234567", email: "" });
      expect(validateStep(1, fd)).toEqual({ ok: true });
    });

    it("aggregates multiple step-1 errors in a single pass", () => {
      const fd = makeFD({ name: "", phone: "bad", email: "no-at" });
      const result = validateStep(1, fd);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.fieldErrors.name).toBeTruthy();
      expect(result.fieldErrors.phone).toBeTruthy();
      expect(result.fieldErrors.email).toBeTruthy();
    });
  });

  describe("step 2 — primary address", () => {
    function step2(overrides: Record<string, string> = {}): FormData {
      return makeFD({
        address_label: "home",
        address_line: "Building 4",
        address_district: "Al Quoz",
        address_emirate: "Dubai",
        ...overrides,
      });
    }

    it("passes when all address fields are present + label is valid", () => {
      expect(validateStep(2, step2())).toEqual({ ok: true });
    });

    it("rejects unknown address label", () => {
      const fd = step2({ address_label: "warehouse" });
      const result = validateStep(2, fd);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.fieldErrors.address_label).toMatch(/home, office, or other/i);
    });

    it("rejects empty district — the §3.22 regression Love flagged", () => {
      const fd = step2({ address_district: "" });
      const result = validateStep(2, fd);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.fieldErrors.address_district).toMatch(/required/i);
    });

    it("rejects empty address line", () => {
      const fd = step2({ address_line: "" });
      const result = validateStep(2, fd);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.fieldErrors.address_line).toMatch(/required/i);
    });

    it("rejects empty emirate", () => {
      const fd = step2({ address_emirate: "" });
      const result = validateStep(2, fd);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.fieldErrors.address_emirate).toMatch(/required/i);
    });

    it("aggregates multiple step-2 errors in one pass", () => {
      const fd = step2({
        address_label: "warehouse",
        address_line: "",
        address_district: "",
        address_emirate: "",
      });
      const result = validateStep(2, fd);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(Object.keys(result.fieldErrors).length).toBe(4);
    });
  });

  describe("step 3 — submit step (no client gate)", () => {
    it("always returns ok=true; final submit is validated server-side via parseOnboardForm", () => {
      // Empty FormData would fail parseOnboardForm, but validateStep
      // intentionally skips step 3 because the server is authoritative
      // for the final submit. Asserts the intent so a future refactor
      // that adds step-3 client rules without updating wizard wiring
      // surfaces in test.
      expect(validateStep(3, new FormData())).toEqual({ ok: true });
    });
  });
});
