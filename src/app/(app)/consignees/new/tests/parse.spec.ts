// Day-25 / brief v1.12 §3.3.1 — flat consignee form parser tests.
//
// Replaces the v1.11 wizard helpers.spec.ts. Tests parseConsigneeForm
// against the flat form shape: identity section + address section,
// single submit. Field-error keys match the form field names.

import { describe, expect, it } from "vitest";

import { parseConsigneeForm } from "../_helpers";

function form(data: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(data)) {
    fd.append(k, v);
  }
  return fd;
}

const VALID = {
  name: "Fatima Al Mansouri",
  phone: "+971501234567",
  email: "fatima@example.com",
  delivery_notes: "Gate code 4221",
  external_ref: "MPL-A1029",
  notes_internal: "VIP — handle with care",
  address_label: "home",
  address_line: "Villa 14, Street 22",
  address_district: "Jumeirah 1",
  address_emirate: "Dubai",
};

describe("parseConsigneeForm", () => {
  it("happy path: returns ok=true with nested { identity, address }", () => {
    const result = parseConsigneeForm(form(VALID));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.identity.name).toBe("Fatima Al Mansouri");
      expect(result.value.identity.phone).toBe("+971501234567");
      expect(result.value.identity.email).toBe("fatima@example.com");
      expect(result.value.address.label).toBe("home");
      expect(result.value.address.line).toBe("Villa 14, Street 22");
      expect(result.value.address.district).toBe("Jumeirah 1");
      expect(result.value.address.emirate).toBe("Dubai");
    }
  });

  it("rejects missing name", () => {
    const result = parseConsigneeForm(form({ ...VALID, name: "  " }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.name).toMatch(/required/i);
  });

  it("rejects missing phone", () => {
    const result = parseConsigneeForm(form({ ...VALID, phone: "" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.phone).toMatch(/required/i);
  });

  it("rejects malformed phone (not E.164)", () => {
    const result = parseConsigneeForm(form({ ...VALID, phone: "0501234567" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.phone).toMatch(/E\.164/);
  });

  it("rejects email without @", () => {
    const result = parseConsigneeForm(form({ ...VALID, email: "not-an-email" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.email).toMatch(/@/);
  });

  it("rejects invalid address label", () => {
    const result = parseConsigneeForm(form({ ...VALID, address_label: "bogus" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.address_label).toMatch(/home, office, or other/);
  });

  it("rejects missing address line", () => {
    const result = parseConsigneeForm(form({ ...VALID, address_line: "" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.address_line).toMatch(/required/i);
  });

  it("rejects missing district", () => {
    const result = parseConsigneeForm(form({ ...VALID, address_district: "" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.address_district).toMatch(/required/i);
  });

  it("rejects missing emirate", () => {
    const result = parseConsigneeForm(form({ ...VALID, address_emirate: "" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.address_emirate).toMatch(/required/i);
  });

  it("omits empty optional fields from the parsed value", () => {
    const result = parseConsigneeForm(
      form({
        name: VALID.name,
        phone: VALID.phone,
        email: "",
        delivery_notes: "",
        external_ref: "",
        notes_internal: "",
        address_label: VALID.address_label,
        address_line: VALID.address_line,
        address_district: VALID.address_district,
        address_emirate: VALID.address_emirate,
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.identity.email).toBeUndefined();
      expect(result.value.identity.deliveryNotes).toBeUndefined();
      expect(result.value.identity.externalRef).toBeUndefined();
      expect(result.value.identity.notesInternal).toBeUndefined();
    }
  });

  it("aggregates multiple field errors", () => {
    const result = parseConsigneeForm(
      form({
        ...VALID,
        name: "",
        phone: "",
        address_line: "",
        address_emirate: "",
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.fieldErrors).sort()).toEqual(
        ["address_emirate", "address_line", "name", "phone"].sort(),
      );
    }
  });
});
