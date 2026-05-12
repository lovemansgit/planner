// Day-22n PR-C-B — Spec for the TaskPreviewRow pure-logic exports.
// Pure-fn coverage; React render assertions deferred per
// memory/followup_client_component_test_infra.md.

import { describe, expect, it } from "vitest";

import type { TaskInternalStatus } from "@/modules/tasks/types";

import {
  STATUS_VISUAL_KEYS,
  buildOverflowCopy,
  getTaskStatusVisuals,
} from "../TaskPreviewRow";

describe("getTaskStatusVisuals", () => {
  it("returns a label + classes pair for every TaskInternalStatus", () => {
    for (const status of STATUS_VISUAL_KEYS) {
      const visual = getTaskStatusVisuals(status);
      expect(visual.label).toBeTruthy();
      expect(visual.classes).toBeTruthy();
    }
  });
  it("uses the brand red palette for FAILED", () => {
    const visual = getTaskStatusVisuals("FAILED");
    expect(visual.label).toBe("Failed");
    expect(visual.classes).toContain("bg-red/15");
    expect(visual.classes).toContain("text-red");
  });
  it("uses the brand green palette for DELIVERED", () => {
    const visual = getTaskStatusVisuals("DELIVERED");
    expect(visual.label).toBe("Delivered");
    expect(visual.classes).toContain("bg-green/15");
    expect(visual.classes).toContain("text-green");
  });
  it("uses navy-tinted palette for ASSIGNED and IN_TRANSIT", () => {
    expect(getTaskStatusVisuals("ASSIGNED").classes).toContain("bg-navy/10");
    expect(getTaskStatusVisuals("IN_TRANSIT").classes).toContain("bg-navy/10");
  });
  it("uses sentence-case labels (not title case or caps)", () => {
    // Sentence case = first word capitalised, rest lowercase.
    expect(getTaskStatusVisuals("IN_TRANSIT").label).toBe("In transit");
    expect(getTaskStatusVisuals("ON_HOLD").label).toBe("On hold");
  });
  it("exposes all 7 TaskInternalStatus values via STATUS_VISUAL_KEYS", () => {
    const expected: readonly TaskInternalStatus[] = [
      "CREATED",
      "ASSIGNED",
      "IN_TRANSIT",
      "DELIVERED",
      "FAILED",
      "CANCELED",
      "ON_HOLD",
    ];
    expect(STATUS_VISUAL_KEYS).toEqual(expected);
  });
});

describe("buildOverflowCopy", () => {
  it("returns null when nothing is hidden", () => {
    expect(buildOverflowCopy(0)).toBeNull();
  });
  it("returns null for negative input (defensive)", () => {
    expect(buildOverflowCopy(-3)).toBeNull();
  });
  it("uses singular '+ 1 more' for one hidden task", () => {
    expect(buildOverflowCopy(1)).toBe("+ 1 more");
  });
  it("uses plural 'and N more deliveries' for >1 hidden", () => {
    expect(buildOverflowCopy(2)).toBe("and 2 more deliveries");
    expect(buildOverflowCopy(47)).toBe("and 47 more deliveries");
  });
});
