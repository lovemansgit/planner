// SuiteFleet → internal status mapper — Day 4 / S-6 unit tests.
//
// Pure function. Covers: every entry of the action-to-status map,
// the null-path for non-lifecycle actions, the null-path for unknown
// actions (with warn log), and the no-vocabulary-leak invariant.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mapSuiteFleetStatusToInternal } from "../status-mapper";

describe("mapSuiteFleetStatusToInternal — every lifecycle-real action", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([
    // CREATED
    ["TASK_HAS_BEEN_ORDERED", "CREATED"],

    // ASSIGNED
    ["TASK_HAS_BEEN_ASSIGNED", "ASSIGNED"],

    // IN_TRANSIT (5 actions collapse here)
    ["TASK_STATUS_UPDATED_TO_ARRIVED_ON_DC", "IN_TRANSIT"],
    ["TASK_STATUS_UPDATED_TO_PICKED_UP", "IN_TRANSIT"],
    ["TASK_STATUS_UPDATED_TO_IN_TRANSIT", "IN_TRANSIT"],
    ["TASK_STATUS_UPDATED_TO_HUB_TRANSFER", "IN_TRANSIT"],
    ["TASK_STATUS_UPDATED_TO_OUT_FOR_DELIVERY", "IN_TRANSIT"],

    // Terminal success
    ["TASK_STATUS_UPDATED_TO_DELIVERED", "DELIVERED"],

    // FAILED — 3 actions collapse here (FAILED, PROCESS_FOR_RETURN, RETURNED_TO_SHIPPER)
    ["TASK_STATUS_UPDATED_TO_FAILED", "FAILED"],
    ["TASK_STATUS_UPDATED_TO_PROCESS_FOR_RETURN", "FAILED"],
    ["TASK_STATUS_UPDATED_TO_RETURNED_TO_SHIPPER", "FAILED"],

    // Terminal cancel
    ["TASK_STATUS_UPDATED_TO_CANCELED", "CANCELED"],

    // ON_HOLD
    ["TASK_STATUS_UPDATED_TO_REATTEMPT", "ON_HOLD"],
    ["TASK_STATUS_UPDATED_TO_RESCHEDULED", "ON_HOLD"],
  ])("maps %s to %s", (action, expectedStatus) => {
    expect(mapSuiteFleetStatusToInternal(action)).toBe(expectedStatus);
  });
});

describe("mapSuiteFleetStatusToInternal — non-lifecycle action", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns null for TASK_HAS_BEEN_UPDATED (edit event, not a status change)", () => {
    expect(mapSuiteFleetStatusToInternal("TASK_HAS_BEEN_UPDATED")).toBeNull();
  });

  it("does NOT warn for TASK_HAS_BEEN_UPDATED (the null is expected, not vocabulary drift)", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    mapSuiteFleetStatusToInternal("TASK_HAS_BEEN_UPDATED");

    const allErr = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allErr).not.toContain("unknown_action_default");
  });
});

describe("mapSuiteFleetStatusToInternal — unknown action default", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns null for an action not in the known map", () => {
    expect(mapSuiteFleetStatusToInternal("TOTALLY_NEW_ACTION")).toBeNull();
  });

  it("emits a warn log when the unknown-action default fires", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    mapSuiteFleetStatusToInternal("BRAND_NEW_SUITEFLEET_EVENT");

    const allErr = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allErr).toContain("unknown_action_default");
    expect(allErr).toContain("BRAND_NEW_SUITEFLEET_EVENT");
  });

  it("does NOT warn for any of the 14 lifecycle-real actions", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    const allLifecycleActions = [
      "TASK_HAS_BEEN_ORDERED",
      "TASK_HAS_BEEN_ASSIGNED",
      "TASK_STATUS_UPDATED_TO_ARRIVED_ON_DC",
      "TASK_STATUS_UPDATED_TO_PICKED_UP",
      "TASK_STATUS_UPDATED_TO_IN_TRANSIT",
      "TASK_STATUS_UPDATED_TO_HUB_TRANSFER",
      "TASK_STATUS_UPDATED_TO_OUT_FOR_DELIVERY",
      "TASK_STATUS_UPDATED_TO_DELIVERED",
      "TASK_STATUS_UPDATED_TO_FAILED",
      "TASK_STATUS_UPDATED_TO_PROCESS_FOR_RETURN",
      "TASK_STATUS_UPDATED_TO_RETURNED_TO_SHIPPER",
      "TASK_STATUS_UPDATED_TO_CANCELED",
      "TASK_STATUS_UPDATED_TO_REATTEMPT",
      "TASK_STATUS_UPDATED_TO_RESCHEDULED",
    ];

    for (const action of allLifecycleActions) {
      mapSuiteFleetStatusToInternal(action);
    }

    const allErr = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allErr).not.toContain("unknown_action_default");
  });
});

describe("mapSuiteFleetStatusToInternal — interface contract", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("every map entry returns a non-null InternalTaskStatus", () => {
    const allowed = new Set([
      "CREATED",
      "ASSIGNED",
      "IN_TRANSIT",
      "DELIVERED",
      "FAILED",
      "CANCELED",
      "ON_HOLD",
    ]);

    const allLifecycleActions = [
      "TASK_HAS_BEEN_ORDERED",
      "TASK_HAS_BEEN_ASSIGNED",
      "TASK_STATUS_UPDATED_TO_ARRIVED_ON_DC",
      "TASK_STATUS_UPDATED_TO_PICKED_UP",
      "TASK_STATUS_UPDATED_TO_IN_TRANSIT",
      "TASK_STATUS_UPDATED_TO_HUB_TRANSFER",
      "TASK_STATUS_UPDATED_TO_OUT_FOR_DELIVERY",
      "TASK_STATUS_UPDATED_TO_DELIVERED",
      "TASK_STATUS_UPDATED_TO_FAILED",
      "TASK_STATUS_UPDATED_TO_PROCESS_FOR_RETURN",
      "TASK_STATUS_UPDATED_TO_RETURNED_TO_SHIPPER",
      "TASK_STATUS_UPDATED_TO_CANCELED",
      "TASK_STATUS_UPDATED_TO_REATTEMPT",
      "TASK_STATUS_UPDATED_TO_RESCHEDULED",
    ];

    for (const action of allLifecycleActions) {
      const result = mapSuiteFleetStatusToInternal(action);
      expect(result).not.toBeNull();
      expect(allowed.has(result as string)).toBe(true);
    }
  });

  it("TASK_HAS_BEEN_UPDATED returns null (non-lifecycle)", () => {
    expect(mapSuiteFleetStatusToInternal("TASK_HAS_BEEN_UPDATED")).toBeNull();
  });

  it("arbitrary unknown action returns null", () => {
    expect(mapSuiteFleetStatusToInternal("not_in_any_known_set")).toBeNull();
  });
});
