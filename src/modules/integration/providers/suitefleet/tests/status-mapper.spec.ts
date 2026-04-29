// SuiteFleet → internal status mapper — Day 4 / S-6 unit tests.
//
// Pure function. Covers: every entry of the 15-action map,
// unknown-action default behaviour + warn log, and the
// no-empty-lifecycle-state-leak invariant (no SuiteFleet substring
// like ARRIVED_ON_DC or HUB_TRANSFER appears in the returned value).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mapSuiteFleetStatusToInternal } from "../status-mapper";

describe("mapSuiteFleetStatusToInternal — every known action", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([
    // CREATED group
    ["TASK_HAS_BEEN_ORDERED", "CREATED"],
    ["TASK_HAS_BEEN_UPDATED", "CREATED"],

    // ASSIGNED
    ["TASK_HAS_BEEN_ASSIGNED", "ASSIGNED"],

    // IN_TRANSIT group (5 actions collapse here)
    ["TASK_STATUS_UPDATED_TO_ARRIVED_ON_DC", "IN_TRANSIT"],
    ["TASK_STATUS_UPDATED_TO_PICKED_UP", "IN_TRANSIT"],
    ["TASK_STATUS_UPDATED_TO_IN_TRANSIT", "IN_TRANSIT"],
    ["TASK_STATUS_UPDATED_TO_HUB_TRANSFER", "IN_TRANSIT"],
    ["TASK_STATUS_UPDATED_TO_OUT_FOR_DELIVERY", "IN_TRANSIT"],

    // Terminal success
    ["TASK_STATUS_UPDATED_TO_DELIVERED", "DELIVERED"],

    // Terminal failure
    ["TASK_STATUS_UPDATED_TO_FAILED", "FAILED"],
    ["TASK_STATUS_UPDATED_TO_RETURNED_TO_SHIPPER", "FAILED"],

    // Terminal cancel
    ["TASK_STATUS_UPDATED_TO_CANCELED", "CANCELED"],

    // ON_HOLD group
    ["TASK_STATUS_UPDATED_TO_REATTEMPT", "ON_HOLD"],
    ["TASK_STATUS_UPDATED_TO_RESCHEDULED", "ON_HOLD"],
    ["TASK_STATUS_UPDATED_TO_PROCESS_FOR_RETURN", "ON_HOLD"],
  ])("maps %s to %s", (action, expectedStatus) => {
    expect(mapSuiteFleetStatusToInternal(action)).toBe(expectedStatus);
  });
});

describe("mapSuiteFleetStatusToInternal — unknown action default", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns CREATED for an action not in the known map", () => {
    expect(mapSuiteFleetStatusToInternal("TOTALLY_NEW_ACTION")).toBe("CREATED");
  });

  it("emits a warn log when the unknown-action default fires", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    mapSuiteFleetStatusToInternal("BRAND_NEW_SUITEFLEET_EVENT");

    const allErr = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allErr).toContain("unknown_action_default");
    expect(allErr).toContain("BRAND_NEW_SUITEFLEET_EVENT");
  });

  it("does NOT warn for any of the 15 known actions", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    const allKnownActions = [
      "TASK_HAS_BEEN_ORDERED",
      "TASK_HAS_BEEN_UPDATED",
      "TASK_HAS_BEEN_ASSIGNED",
      "TASK_STATUS_UPDATED_TO_ARRIVED_ON_DC",
      "TASK_STATUS_UPDATED_TO_PICKED_UP",
      "TASK_STATUS_UPDATED_TO_IN_TRANSIT",
      "TASK_STATUS_UPDATED_TO_HUB_TRANSFER",
      "TASK_STATUS_UPDATED_TO_OUT_FOR_DELIVERY",
      "TASK_STATUS_UPDATED_TO_DELIVERED",
      "TASK_STATUS_UPDATED_TO_FAILED",
      "TASK_STATUS_UPDATED_TO_RETURNED_TO_SHIPPER",
      "TASK_STATUS_UPDATED_TO_CANCELED",
      "TASK_STATUS_UPDATED_TO_REATTEMPT",
      "TASK_STATUS_UPDATED_TO_RESCHEDULED",
      "TASK_STATUS_UPDATED_TO_PROCESS_FOR_RETURN",
    ];

    for (const action of allKnownActions) {
      mapSuiteFleetStatusToInternal(action);
    }

    const allErr = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allErr).not.toContain("unknown_action_default");
  });
});

describe("mapSuiteFleetStatusToInternal — no SuiteFleet vocabulary leakage", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns one of the seven internal states for every known action", () => {
    const allowed = new Set([
      "CREATED",
      "ASSIGNED",
      "IN_TRANSIT",
      "DELIVERED",
      "FAILED",
      "CANCELED",
      "ON_HOLD",
    ]);

    const allKnownActions = [
      "TASK_HAS_BEEN_ORDERED",
      "TASK_HAS_BEEN_UPDATED",
      "TASK_HAS_BEEN_ASSIGNED",
      "TASK_STATUS_UPDATED_TO_ARRIVED_ON_DC",
      "TASK_STATUS_UPDATED_TO_PICKED_UP",
      "TASK_STATUS_UPDATED_TO_IN_TRANSIT",
      "TASK_STATUS_UPDATED_TO_HUB_TRANSFER",
      "TASK_STATUS_UPDATED_TO_OUT_FOR_DELIVERY",
      "TASK_STATUS_UPDATED_TO_DELIVERED",
      "TASK_STATUS_UPDATED_TO_FAILED",
      "TASK_STATUS_UPDATED_TO_RETURNED_TO_SHIPPER",
      "TASK_STATUS_UPDATED_TO_CANCELED",
      "TASK_STATUS_UPDATED_TO_REATTEMPT",
      "TASK_STATUS_UPDATED_TO_RESCHEDULED",
      "TASK_STATUS_UPDATED_TO_PROCESS_FOR_RETURN",
    ];

    for (const action of allKnownActions) {
      expect(allowed.has(mapSuiteFleetStatusToInternal(action))).toBe(true);
    }
  });
});
