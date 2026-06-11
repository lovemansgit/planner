// Day-53 EVE — relocation pin for the shared task-timeline surface.
//
// R6-part-2 (memory/followup_r6_part2_awb_drawer.md) is blocked on the
// drawer + its server actions being importable OUTSIDE
// src/app/(app)/consignees/[id]/**. This spec pins the shared module
// surface at src/components/task-timeline/ — if either export moves or
// the action file re-couples to the route dir, this fails.

import { describe, expect, it, vi } from "vitest";

// The shared actions file transitively imports @/modules/tasks →
// @/shared/db, which requires env at import time. Mock the module
// boundaries — this spec pins the EXPORT SURFACE/location, not behavior
// (behavior is covered where the drawer + services are tested).
vi.mock("server-only", () => ({}));
vi.mock("@/modules/tasks", () => ({
  getTaskTimeline: vi.fn(),
  getTaskHistory: vi.fn(),
}));
vi.mock("@/shared/request-context", () => ({
  buildRequestContext: vi.fn(),
}));

describe("shared task-timeline surface (Day-53 relocation)", () => {
  it("TaskTimelineDrawer is exported from @/components/task-timeline/TaskTimelineDrawer", async () => {
    const mod = await import("@/components/task-timeline/TaskTimelineDrawer");
    expect(typeof mod.TaskTimelineDrawer).toBe("function");
  });

  it("both drawer server actions are exported from @/components/task-timeline/actions", async () => {
    const mod = await import("@/components/task-timeline/actions");
    expect(typeof mod.getTaskTimelineAction).toBe("function");
    expect(typeof mod.getTaskHistoryAction).toBe("function");
  });
});
