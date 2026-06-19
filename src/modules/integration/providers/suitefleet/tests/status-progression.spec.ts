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

describe("shouldAdvanceStatus — monotonic / terminal guard", () => {
  it("advances forward CREATED -> IN_TRANSIT", () => {
    expect(shouldAdvanceStatus("CREATED", "IN_TRANSIT")).toBe(true);
  });

  it("advances forward IN_TRANSIT -> DELIVERED", () => {
    expect(shouldAdvanceStatus("IN_TRANSIT", "DELIVERED")).toBe(true);
  });

  it("does NOT regress DELIVERED -> IN_TRANSIT (lagging webhook — the core bug)", () => {
    expect(shouldAdvanceStatus("DELIVERED", "IN_TRANSIT")).toBe(false);
  });

  it("does NOT regress ASSIGNED -> CREATED (lagging ORDERED)", () => {
    expect(shouldAdvanceStatus("ASSIGNED", "CREATED")).toBe(false);
  });

  it("is a no-op on equal status (dedup: master + dedicated compose)", () => {
    expect(shouldAdvanceStatus("IN_TRANSIT", "IN_TRANSIT")).toBe(false);
    expect(shouldAdvanceStatus("DELIVERED", "DELIVERED")).toBe(false);
  });

  it("treats DELIVERED as hard-terminal (no DELIVERED -> CANCELED via webhook)", () => {
    expect(shouldAdvanceStatus("DELIVERED", "CANCELED")).toBe(false);
  });

  it("treats CANCELED as terminal", () => {
    expect(shouldAdvanceStatus("CANCELED", "IN_TRANSIT")).toBe(false);
    expect(shouldAdvanceStatus("CANCELED", "DELIVERED")).toBe(false);
  });

  it("preserves the operator-set SKIPPED guard (never overwritten by a webhook status)", () => {
    expect(shouldAdvanceStatus("SKIPPED", "IN_TRANSIT")).toBe(false);
    expect(shouldAdvanceStatus("SKIPPED", "DELIVERED")).toBe(false);
  });

  it("allows ON_HOLD -> IN_TRANSIT (resume from a hold)", () => {
    expect(shouldAdvanceStatus("ON_HOLD", "IN_TRANSIT")).toBe(true);
  });

  it("allows a non-terminal task to reach a terminal failure", () => {
    expect(shouldAdvanceStatus("IN_TRANSIT", "FAILED")).toBe(true);
    expect(shouldAdvanceStatus("IN_TRANSIT", "CANCELED")).toBe(true);
  });
});
