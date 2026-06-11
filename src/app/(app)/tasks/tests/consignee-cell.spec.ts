// Day-53 R6-part-1 — consignee-block cell model helper.
//
// Mirrors the pod-state.spec.ts pure-helper convention (no render
// harness in this repo — vitest runs node-only). Tests the only real
// logic in the new consignee columns: the single /consignees/[id] click
// target href (R6.4) and the dash-fallback for null/blank fields
// (fall-through rows where the projection produced NULL).

import { describe, expect, it } from "vitest";

import { consigneeCellModel } from "../_components/consignee-cell";

const FULL = {
  consigneeId: "22222222-2222-2222-2222-222222222222",
  consigneeName: "Sarah Khan",
  effectiveAddressLine: "Villa 12, Street 4",
  effectiveDistrict: "Al Barsha",
  effectiveEmirate: "Dubai",
  consigneePhone: "+971500000001",
};

describe("consigneeCellModel", () => {
  it("builds the single consignee-detail href from consigneeId (R6.4 click target)", () => {
    expect(consigneeCellModel(FULL).href).toBe(
      "/consignees/22222222-2222-2222-2222-222222222222",
    );
  });

  it("passes through populated name, address, district, emirate, telephone", () => {
    const model = consigneeCellModel(FULL);
    expect(model.name).toBe("Sarah Khan");
    expect(model.addressLine).toBe("Villa 12, Street 4");
    expect(model.district).toBe("Al Barsha");
    expect(model.emirate).toBe("Dubai");
    expect(model.telephone).toBe("+971500000001");
  });

  it("renders an em-dash for null fields (fall-through / missing data)", () => {
    const model = consigneeCellModel({
      ...FULL,
      consigneeName: null,
      effectiveAddressLine: null,
      effectiveDistrict: null,
      effectiveEmirate: null,
      consigneePhone: null,
    });
    expect(model.name).toBe("—");
    expect(model.addressLine).toBe("—");
    expect(model.district).toBe("—");
    expect(model.emirate).toBe("—");
    expect(model.telephone).toBe("—");
  });

  it("renders an em-dash for whitespace-only fields", () => {
    expect(consigneeCellModel({ ...FULL, consigneeName: "   " }).name).toBe("—");
  });
});
