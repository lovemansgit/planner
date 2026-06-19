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

import { mapSuiteFleetStatusValueToInternal, shouldAdvanceStatus } from "../status-progression";

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
