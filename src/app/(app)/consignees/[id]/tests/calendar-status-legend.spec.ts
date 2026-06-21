// D56 Phase 8 / Lane 4 — CalendarStatusLegend family-grouping coverage.
//
// Pins that the family-grouped legend is EXHAUSTIVE over the 14 fine courier
// states: every CourierStatus appears exactly once across the family groups.
// A new fine state (or a typo / accidental duplicate) fails here rather than
// silently dropping a state from the operator's legend.

import { describe, expect, it } from "vitest";

import { COURIER_STATUS_DISPLAY } from "@/app/(app)/tasks/status";
import type { CourierStatus } from "@/modules/integration";

import { LEGEND_FAMILIES } from "../_components/CalendarStatusLegend";

const ALL_COURIER_STATUSES = Object.keys(COURIER_STATUS_DISPLAY) as CourierStatus[];

describe("LEGEND_FAMILIES", () => {
  it("covers every fine courier state exactly once", () => {
    const flattened = LEGEND_FAMILIES.flatMap((f) => f.states);
    expect(new Set(flattened).size).toBe(flattened.length); // no duplicates
    expect([...flattened].sort()).toEqual([...ALL_COURIER_STATUSES].sort()); // none missing/extra
  });

  it("places IN_TRANSIT and OUT_FOR_DELIVERY in the same In transit family (distinct chips, not folded)", () => {
    const inTransit = LEGEND_FAMILIES.find((f) => f.heading === "In transit");
    expect(inTransit?.states).toContain("IN_TRANSIT");
    expect(inTransit?.states).toContain("OUT_FOR_DELIVERY");
  });

  it("groups the failure family together", () => {
    const failed = LEGEND_FAMILIES.find((f) => f.heading === "Failed / returned");
    expect(failed?.states).toEqual(["FAILED", "PROCESS_FOR_RETURN", "RETURNED_TO_SHIPPER"]);
  });

  it("every family has a non-empty heading and at least one state", () => {
    for (const family of LEGEND_FAMILIES) {
      expect(family.heading.length).toBeGreaterThan(0);
      expect(family.states.length).toBeGreaterThan(0);
    }
  });
});
