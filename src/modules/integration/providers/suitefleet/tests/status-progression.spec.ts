// status-progression unit tests — Day-67 P1 (inbound status from master payload).
//
// Pure functions, no DB. Covers:
//   - mapSuiteFleetStatusValueToInternal: the SF top-level `status` FIELD
//     vocabulary (distinct from the ACTION vocabulary the action-mapper
//     handles). Load-bearing gotcha: the value is `ARRIVED_IN_DC` while the
//     matching action is `TASK_STATUS_UPDATED_TO_ARRIVED_ON_DC` (IN vs ON).
//     The 8 mapped values here are empirically observed in production
//     webhook_events (2026-06-19 read-only diagnostic); the inferred-by-
//     symmetry values are covered by the unknown -> null path.
//   - shouldAdvanceStatus: monotonic/terminal guard so master + dedicated
//     status events compose idempotently and status never regresses.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  mapSuiteFleetStatusValueToCourierStatus,
  mapSuiteFleetStatusValueToInternal,
  shouldAdvanceCourierStatus,
  shouldAdvanceStatus,
} from "../status-progression";

describe("mapSuiteFleetStatusValueToInternal — observed SF `status` field values", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ["ORDERED", "CREATED"],
    ["ASSIGNED", "ASSIGNED"],
    ["PICKED_UP", "IN_TRANSIT"],
    // GOTCHA: value spelling differs from the action suffix (ARRIVED_ON_DC).
    ["ARRIVED_IN_DC", "IN_TRANSIT"],
    ["IN_TRANSIT", "IN_TRANSIT"],
    ["OUT_FOR_DELIVERY", "IN_TRANSIT"],
    ["DELIVERED", "DELIVERED"],
    ["FAILED", "FAILED"],
    ["CANCELED", "CANCELED"],
  ])("maps status value %s -> %s", (value, expected) => {
    expect(mapSuiteFleetStatusValueToInternal(value)).toBe(expected);
  });

  it("returns null (no advance) for an unknown status value", () => {
    expect(mapSuiteFleetStatusValueToInternal("WAT_IS_THIS")).toBeNull();
  });

  it("returns null for an empty / missing value", () => {
    expect(mapSuiteFleetStatusValueToInternal("")).toBeNull();
  });
});

// Love's ruling (2026-06-19): allow Reschedule/Reattempt/Failed to MOVE the
// status — they are real transitions operators must see. BLOCK only:
//   (1) moving OUT of a terminal (DELIVERED / CANCELED);
//   (2) overwriting operator-set SKIPPED;
//   (3) re-applying the SAME status (master + dedicated dedup);
//   (4) a stale early webhook dropping a forward-linear status BACK
//       (CREATED < ASSIGNED < IN_TRANSIT only).
describe("shouldAdvanceStatus — Love-ruled transition policy", () => {
  it("advances the forward linear path CREATED -> ASSIGNED -> IN_TRANSIT", () => {
    expect(shouldAdvanceStatus("CREATED", "ASSIGNED")).toBe(true);
    expect(shouldAdvanceStatus("CREATED", "IN_TRANSIT")).toBe(true);
    expect(shouldAdvanceStatus("ASSIGNED", "IN_TRANSIT")).toBe(true);
    expect(shouldAdvanceStatus("IN_TRANSIT", "DELIVERED")).toBe(true);
  });

  // (1) terminals don't un-happen
  it("blocks moving OUT of DELIVERED / CANCELED (terminal-lock)", () => {
    expect(shouldAdvanceStatus("DELIVERED", "IN_TRANSIT")).toBe(false); // the core bug
    expect(shouldAdvanceStatus("DELIVERED", "CANCELED")).toBe(false);
    expect(shouldAdvanceStatus("CANCELED", "IN_TRANSIT")).toBe(false);
    expect(shouldAdvanceStatus("CANCELED", "DELIVERED")).toBe(false);
  });

  // (2) operator-set SKIPPED is never overwritten by a webhook status
  it("blocks overwriting operator-set SKIPPED", () => {
    expect(shouldAdvanceStatus("SKIPPED", "IN_TRANSIT")).toBe(false);
    expect(shouldAdvanceStatus("SKIPPED", "DELIVERED")).toBe(false);
  });

  // (3) same-status dedup (master + dedicated event for one transition)
  it("is a no-op on the same status (dedup)", () => {
    expect(shouldAdvanceStatus("IN_TRANSIT", "IN_TRANSIT")).toBe(false);
    expect(shouldAdvanceStatus("ON_HOLD", "ON_HOLD")).toBe(false);
  });

  // (4) stale early webhook may not drag the forward-linear path backward
  it("blocks a stale early webhook dropping In-transit back to Created/Assigned", () => {
    expect(shouldAdvanceStatus("IN_TRANSIT", "ASSIGNED")).toBe(false);
    expect(shouldAdvanceStatus("IN_TRANSIT", "CREATED")).toBe(false);
    expect(shouldAdvanceStatus("ASSIGNED", "CREATED")).toBe(false);
  });

  // Love-ruled ALLOW: Reschedule / Reattempt / Failed move the status.
  it("ALLOWS In-transit -> On-hold (a rescheduled/re-attempted parcel)", () => {
    expect(shouldAdvanceStatus("IN_TRANSIT", "ON_HOLD")).toBe(true);
  });

  it("ALLOWS Failed -> On-hold and Failed -> In-transit (re-attempt un-freezes)", () => {
    expect(shouldAdvanceStatus("FAILED", "ON_HOLD")).toBe(true);
    expect(shouldAdvanceStatus("FAILED", "IN_TRANSIT")).toBe(true);
  });

  it("ALLOWS On-hold -> In-transit (resume) and any non-terminal -> Failed/Cancelled/Delivered", () => {
    expect(shouldAdvanceStatus("ON_HOLD", "IN_TRANSIT")).toBe(true);
    expect(shouldAdvanceStatus("IN_TRANSIT", "FAILED")).toBe(true);
    expect(shouldAdvanceStatus("IN_TRANSIT", "CANCELED")).toBe(true);
    expect(shouldAdvanceStatus("FAILED", "DELIVERED")).toBe(true);
  });
});

// =============================================================================
// D56 Phase 8 / Lane 2 — fine courier-status VALUE mapper.
//
// Sibling of mapSuiteFleetStatusValueToInternal: the SF top-level `status`
// FIELD vocabulary, but mapped 1:1 to the DISTINCT fine courier_status set
// instead of collapsing to the coarse 7. Same load-bearing gotcha as the
// coarse value map — the value spelling is ARRIVED_IN_DC (not the action's
// ARRIVED_ON_DC) and folds to the single fine state ARRIVED_AT_DC.
// =============================================================================

describe("mapSuiteFleetStatusValueToCourierStatus — value -> distinct fine state", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ["ORDERED", "ORDERED"],
    ["ASSIGNED", "ASSIGNED"],
    ["PICKED_UP", "PICKED_UP"],
    // GOTCHA: value is ARRIVED_IN_DC; folds to the single fine state ARRIVED_AT_DC.
    ["ARRIVED_IN_DC", "ARRIVED_AT_DC"],
    ["IN_TRANSIT", "IN_TRANSIT"],
    ["HUB_TRANSFER", "HUB_TRANSFER"],
    ["OUT_FOR_DELIVERY", "OUT_FOR_DELIVERY"],
    ["DELIVERED", "DELIVERED"],
    ["FAILED", "FAILED"],
    ["PROCESS_FOR_RETURN", "PROCESS_FOR_RETURN"],
    ["RETURNED_TO_SHIPPER", "RETURNED_TO_SHIPPER"],
    ["CANCELED", "CANCELED"],
    ["RESCHEDULED", "RESCHEDULED"],
    ["REATTEMPT", "REATTEMPT"],
  ])("maps status value %s -> fine %s", (value, expected) => {
    expect(mapSuiteFleetStatusValueToCourierStatus(value)).toBe(expected);
  });

  it("maps the value vocab onto 14 DISTINCT fine states (no collapse)", () => {
    const values = [
      "ORDERED",
      "ASSIGNED",
      "PICKED_UP",
      "ARRIVED_IN_DC",
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
    ];
    const fine = values.map((v) => mapSuiteFleetStatusValueToCourierStatus(v));
    expect(fine.every((f) => f !== null)).toBe(true);
    expect(new Set(fine).size).toBe(14);
  });

  it("returns null for an unknown status value", () => {
    expect(mapSuiteFleetStatusValueToCourierStatus("WAT_IS_THIS")).toBeNull();
  });

  it("returns null for an empty / missing value", () => {
    expect(mapSuiteFleetStatusValueToCourierStatus("")).toBeNull();
  });

  it("does NOT warn on unknown values (coarse value mapper is the single drift sentinel)", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    mapSuiteFleetStatusValueToCourierStatus("WAT_IS_THIS");

    const allErr = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allErr).not.toContain("unknown_status_value");
  });
});

// =============================================================================
// D56 Phase 8 / Lane 2 — shouldAdvanceCourierStatus (fine transition guard).
//
// The coarse shouldAdvanceStatus dedups on coarse status, so a
// PICKED_UP -> OUT_FOR_DELIVERY transition (both coarse IN_TRANSIT) is a
// coarse no-op and would NEVER advance the fine column. This fine guard gives
// the in-transit ramp its own forward-linear rank so:
//   - the fine column advances even when the coarse column no-ops, and
//   - a lagging webhook cannot regress OUT_FOR_DELIVERY back down the ramp.
//
// The fine forward spine mirrors the coarse spine (CREATED<ASSIGNED<IN_TRANSIT)
// with the single IN_TRANSIT rung expanded into the 5-rung ramp:
//   ORDERED < ASSIGNED < PICKED_UP < ARRIVED_AT_DC < IN_TRANSIT
//           < HUB_TRANSFER < OUT_FOR_DELIVERY
// Terminal-lock (DELIVERED/CANCELED) and dedup mirror the coarse rules. Branch
// states (FAILED, returns, holds) are off-spine — real transitions, never
// blocked as "backward".
// =============================================================================

// The third arg is the row's coarse internal_status. During the in-transit
// ramp the coarse status is always "IN_TRANSIT" (all five ramp rungs collapse
// to it); ORDERED↔ASSIGNED carry coarse CREATED/ASSIGNED; the off-spine branch
// states carry their own coarse (FAILED, ON_HOLD). The coarse arg only
// gates the {SKIPPED, DELIVERED, CANCELED} freezes — any other live coarse
// value is treated identically, so these fine-logic cases pass the realistic
// (non-frozen) coarse context.
describe("shouldAdvanceCourierStatus — fine in-transit ramp + terminal/dedup guards", () => {
  // The headline property: coarse no-ops while fine advances within IN_TRANSIT.
  it("advances the in-transit ramp (each rung forward)", () => {
    expect(shouldAdvanceCourierStatus("ORDERED", "ASSIGNED", "CREATED")).toBe(true);
    expect(shouldAdvanceCourierStatus("ASSIGNED", "PICKED_UP", "ASSIGNED")).toBe(true);
    expect(shouldAdvanceCourierStatus("PICKED_UP", "ARRIVED_AT_DC", "IN_TRANSIT")).toBe(true);
    expect(shouldAdvanceCourierStatus("ARRIVED_AT_DC", "IN_TRANSIT", "IN_TRANSIT")).toBe(true);
    expect(shouldAdvanceCourierStatus("IN_TRANSIT", "HUB_TRANSFER", "IN_TRANSIT")).toBe(true);
    expect(shouldAdvanceCourierStatus("HUB_TRANSFER", "OUT_FOR_DELIVERY", "IN_TRANSIT")).toBe(true);
  });

  it("advances when the coarse column would no-op — PICKED_UP -> OUT_FOR_DELIVERY (both coarse IN_TRANSIT)", () => {
    expect(shouldAdvanceCourierStatus("PICKED_UP", "OUT_FOR_DELIVERY", "IN_TRANSIT")).toBe(true);
  });

  it("BLOCKS a lagging webhook regressing the ramp (OUT_FOR_DELIVERY can't drop back to PICKED_UP)", () => {
    expect(shouldAdvanceCourierStatus("OUT_FOR_DELIVERY", "PICKED_UP", "IN_TRANSIT")).toBe(false);
    expect(shouldAdvanceCourierStatus("OUT_FOR_DELIVERY", "IN_TRANSIT", "IN_TRANSIT")).toBe(false);
    expect(shouldAdvanceCourierStatus("IN_TRANSIT", "ARRIVED_AT_DC", "IN_TRANSIT")).toBe(false);
    expect(shouldAdvanceCourierStatus("ARRIVED_AT_DC", "PICKED_UP", "IN_TRANSIT")).toBe(false);
  });

  it("BLOCKS a lagging ASSIGNED/ORDERED dragging a moving parcel back down the spine", () => {
    expect(shouldAdvanceCourierStatus("PICKED_UP", "ASSIGNED", "IN_TRANSIT")).toBe(false);
    expect(shouldAdvanceCourierStatus("PICKED_UP", "ORDERED", "IN_TRANSIT")).toBe(false);
    expect(shouldAdvanceCourierStatus("ASSIGNED", "ORDERED", "ASSIGNED")).toBe(false);
  });

  it("is a no-op on the same fine state (master + dedicated event dedup)", () => {
    expect(shouldAdvanceCourierStatus("IN_TRANSIT", "IN_TRANSIT", "IN_TRANSIT")).toBe(false);
    expect(shouldAdvanceCourierStatus("OUT_FOR_DELIVERY", "OUT_FOR_DELIVERY", "IN_TRANSIT")).toBe(
      false
    );
    expect(shouldAdvanceCourierStatus("RESCHEDULED", "RESCHEDULED", "ON_HOLD")).toBe(false);
  });

  it("advances from NULL (the first fine state backfills — nothing to regress from)", () => {
    // The coarse arg is the PRIOR coarse status (before this event lands); a
    // DELIVERED event arrives while the task is still coarse IN_TRANSIT and the
    // same UPDATE advances both columns. (NULL fine + already-terminal coarse is
    // covered by the coarse-lock suite below — that case is frozen.)
    expect(shouldAdvanceCourierStatus(null, "ORDERED", "CREATED")).toBe(true);
    expect(shouldAdvanceCourierStatus(null, "OUT_FOR_DELIVERY", "IN_TRANSIT")).toBe(true);
    expect(shouldAdvanceCourierStatus(null, "DELIVERED", "IN_TRANSIT")).toBe(true);
  });

  it("ALLOWS off-spine branch transitions operators must see (failures, returns, holds, reattempt)", () => {
    expect(shouldAdvanceCourierStatus("IN_TRANSIT", "FAILED", "IN_TRANSIT")).toBe(true);
    expect(shouldAdvanceCourierStatus("FAILED", "PROCESS_FOR_RETURN", "FAILED")).toBe(true);
    expect(shouldAdvanceCourierStatus("PROCESS_FOR_RETURN", "RETURNED_TO_SHIPPER", "FAILED")).toBe(
      true
    );
    expect(shouldAdvanceCourierStatus("OUT_FOR_DELIVERY", "FAILED", "IN_TRANSIT")).toBe(true);
    expect(shouldAdvanceCourierStatus("FAILED", "RESCHEDULED", "FAILED")).toBe(true);
    expect(shouldAdvanceCourierStatus("RESCHEDULED", "REATTEMPT", "ON_HOLD")).toBe(true);
    expect(shouldAdvanceCourierStatus("REATTEMPT", "OUT_FOR_DELIVERY", "ON_HOLD")).toBe(true);
    expect(shouldAdvanceCourierStatus("FAILED", "DELIVERED", "FAILED")).toBe(true);
  });
});

// The fine column is a refinement of the coarse lifecycle: a coarse freeze
// (operator SKIPPED, or DELIVERED/CANCELED terminal) must stop the fine column
// from moving too — including the not-yet-backfilled case where courier_status
// is NULL but internal_status is already frozen (manual cancel / pre-backfill
// row). Without this a NULL fine column would backfill a non-terminal fine
// state onto a terminal task.
describe("shouldAdvanceCourierStatus — coarse lifecycle lock freezes the fine column", () => {
  it("BLOCKS backfilling a fine state onto a coarse-terminal task (NULL fine + DELIVERED/CANCELED coarse)", () => {
    expect(shouldAdvanceCourierStatus(null, "OUT_FOR_DELIVERY", "DELIVERED")).toBe(false);
    expect(shouldAdvanceCourierStatus(null, "IN_TRANSIT", "CANCELED")).toBe(false);
  });

  it("BLOCKS backfilling a fine state onto an operator-SKIPPED task (NULL fine + SKIPPED coarse)", () => {
    expect(shouldAdvanceCourierStatus(null, "PICKED_UP", "SKIPPED")).toBe(false);
    expect(shouldAdvanceCourierStatus(null, "DELIVERED", "SKIPPED")).toBe(false);
  });

  it("freezes even a would-be ramp advance when the coarse status is frozen", () => {
    expect(shouldAdvanceCourierStatus("PICKED_UP", "OUT_FOR_DELIVERY", "CANCELED")).toBe(false);
    expect(shouldAdvanceCourierStatus("PICKED_UP", "OUT_FOR_DELIVERY", "SKIPPED")).toBe(false);
  });

  it("still applies the fine terminal-lock defensively when coarse is live but fine is already terminal", () => {
    // Artificial coarse/fine inconsistency — proves guard (4) is belt-and-braces.
    expect(shouldAdvanceCourierStatus("DELIVERED", "OUT_FOR_DELIVERY", "IN_TRANSIT")).toBe(false);
    expect(shouldAdvanceCourierStatus("CANCELED", "IN_TRANSIT", "IN_TRANSIT")).toBe(false);
  });
});
