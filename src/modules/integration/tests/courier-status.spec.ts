// Phase 8 / Lane 1 — the CourierStatus contract.
//
// COURIER_STATUS_VALUES is the SINGLE shared definition the mapper
// (Lane 2) and the render layer (Lanes 3-5) both import via the
// integration module's public index. Session A builds the mapper against
// this exact list — order + spelling are load-bearing and must not drift,
// and they must mirror the `tasks.courier_status` CHECK in
// supabase/migrations/0035_tasks_courier_status.sql. These tests pin the
// list and assert exhaustiveness at both runtime and compile time.

import { describe, expect, it } from "vitest";

// Import from the module's own `types` (intra-module, side-effect-free) —
// NOT the public barrel `..`, whose provider/db re-exports require DB env
// at module load and would break this pure unit test.
import { COURIER_STATUS_VALUES, type CourierStatus } from "../types";

// The locked 14-value list, spelled out independently of the source so a
// drift in either direction (re-order, rename, add, drop) fails loudly.
const EXPECTED_COURIER_STATUSES = [
  "ORDERED",
  "ASSIGNED",
  "PICKED_UP",
  "ARRIVED_AT_DC",
  "IN_TRANSIT",
  "HUB_TRANSFER",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "FAILED",
  "PROCESS_FOR_RETURN",
  "RETURNED_TO_SHIPPER",
  "CANCELED",
  "RESCHEDULED",
  "REATTEMPT",
] as const;

describe("CourierStatus contract (Phase 8 / Lane 1)", () => {
  it("is exactly the 14 fine SF courier states, in the locked order", () => {
    expect([...COURIER_STATUS_VALUES]).toEqual([...EXPECTED_COURIER_STATUSES]);
    expect(COURIER_STATUS_VALUES).toHaveLength(14);
  });

  it("has no duplicate values", () => {
    expect(new Set(COURIER_STATUS_VALUES).size).toBe(COURIER_STATUS_VALUES.length);
  });

  it("folds ARRIVED into a single ARRIVED_AT_DC state (no ON_DC/IN_DC split)", () => {
    expect(COURIER_STATUS_VALUES).toContain("ARRIVED_AT_DC");
    expect(COURIER_STATUS_VALUES).not.toContain("ARRIVED_ON_DC");
    expect(COURIER_STATUS_VALUES).not.toContain("ARRIVED_IN_DC");
  });

  it("excludes the non-lifecycle TASK_HAS_BEEN_UPDATED edit (not a courier status)", () => {
    expect(COURIER_STATUS_VALUES).not.toContain("TASK_HAS_BEEN_UPDATED");
    expect(COURIER_STATUS_VALUES).not.toContain("UPDATED");
  });

  it("is exhaustive — the type union and the value list cover the same set", () => {
    // A Record keyed by the CourierStatus union forces a COMPILE error if
    // a value is added to or removed from the type without updating this
    // map. The runtime assertion confirms the map's keys are exactly the
    // value list — closing the loop between the type and the const array.
    const handled: Record<CourierStatus, true> = {
      ORDERED: true,
      ASSIGNED: true,
      PICKED_UP: true,
      ARRIVED_AT_DC: true,
      IN_TRANSIT: true,
      HUB_TRANSFER: true,
      OUT_FOR_DELIVERY: true,
      DELIVERED: true,
      FAILED: true,
      PROCESS_FOR_RETURN: true,
      RETURNED_TO_SHIPPER: true,
      CANCELED: true,
      RESCHEDULED: true,
      REATTEMPT: true,
    };
    expect(Object.keys(handled).sort()).toEqual([...COURIER_STATUS_VALUES].sort());
  });
});
