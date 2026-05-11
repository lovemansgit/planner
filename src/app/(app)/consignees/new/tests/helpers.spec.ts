// Day 22 / Phase 1 forms lane — onboard-consignee form parser tests.

import { describe, expect, it } from "vitest";

import { parseOnboardForm } from "../_helpers";

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
