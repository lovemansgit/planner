// D56 Phase 8 / Lane 4 — DayDisplayStatus projection unit tests.
//
// Supersedes the Day-20 fold/mislabel contract: the calendar now renders the
// FINE SuiteFleet courier state distinctly (via Lane 3's resolveCourierDisplay)
// instead of collapsing IN_TRANSIT → "Out for delivery" and ASSIGNED | CREATED
// | ON_HOLD → "Scheduled". The projection is a discriminated union — an
// `exception` overlay (SKIPPED/APPENDED/CANCELED) or a `courier` render.
//
// Precedence (unchanged) + the unfold/mislabel fix + NULL→coarse fallback are
// all pinned below.

import { describe, expect, it } from "vitest";

import type { CourierStatus } from "@/modules/integration";
import type { SubscriptionException } from "@/modules/subscription-exceptions";
import type { Task, TaskInternalStatus } from "@/modules/tasks/types";

import {
  dayCellVisual,
  filterTasksByCourierStatus,
  projectDayDisplayStatus,
  type DayDisplayProjection,
} from "../_components/DayDisplayStatus";

const ANY_DATE = "2026-05-15";

/** Minimal Task fixture — only the two fields the projection reads. */
function task(
  internalStatus: TaskInternalStatus,
  courierStatus: CourierStatus | null = null,
): Task {
  return { internalStatus, courierStatus } as unknown as Task;
}

function exception(
  type: SubscriptionException["type"],
  startDate: string,
): SubscriptionException {
  return { type, startDate } as unknown as SubscriptionException;
}

/** Assert a courier projection and return its label for further checks. */
function courierLabel(projection: DayDisplayProjection | null): string {
  expect(projection).not.toBeNull();
  expect(projection!.kind).toBe("courier");
  if (projection!.kind !== "courier") throw new Error("not courier");
  return projection!.display.label;
}

describe("projectDayDisplayStatus — exception precedence (unchanged)", () => {
  it("returns the SKIPPED overlay when no task and a skip exception falls on the date", () => {
    const result = projectDayDisplayStatus(null, [exception("skip", ANY_DATE)], ANY_DATE);
    expect(result).toEqual({ kind: "exception", status: "SKIPPED" });
  });

  it("returns null when no task and no exception falls on the date", () => {
    expect(projectDayDisplayStatus(null, [], ANY_DATE)).toBeNull();
  });

  it("returns null when no task and only an unrelated-date skip exception exists", () => {
    const exceptions = [exception("skip", "2026-05-16")];
    expect(projectDayDisplayStatus(null, exceptions, ANY_DATE)).toBeNull();
  });

  it("returns the APPENDED overlay when a task exists and an append-without-skip exception matches the date (overrides courier render)", () => {
    const exceptions = [exception("append_without_skip", ANY_DATE)];
    const result = projectDayDisplayStatus(task("DELIVERED", "DELIVERED"), exceptions, ANY_DATE);
    expect(result).toEqual({ kind: "exception", status: "APPENDED" });
  });

  it("returns the CANCELED overlay (muted treatment) for a CANCELED task", () => {
    expect(projectDayDisplayStatus(task("CANCELED"), [], ANY_DATE)).toEqual({
      kind: "exception",
      status: "CANCELED",
    });
  });

  it("returns the SKIPPED overlay for a task-level SKIPPED row (Day-28 fix, post-0019 enum)", () => {
    expect(projectDayDisplayStatus(task("SKIPPED"), [], ANY_DATE)).toEqual({
      kind: "exception",
      status: "SKIPPED",
    });
  });
});

describe("projectDayDisplayStatus — fine courier render (unfold + mislabel fix)", () => {
  it("IN_TRANSIT renders 'In transit' (NOT 'Out for delivery')", () => {
    const label = courierLabel(projectDayDisplayStatus(task("IN_TRANSIT", "IN_TRANSIT"), [], ANY_DATE));
    expect(label).toBe("In transit");
    expect(label).not.toBe("Out for delivery");
  });

  it("OUT_FOR_DELIVERY renders 'Out for delivery' — distinct from in transit", () => {
    expect(courierLabel(projectDayDisplayStatus(task("IN_TRANSIT", "OUT_FOR_DELIVERY"), [], ANY_DATE))).toBe(
      "Out for delivery",
    );
  });

  it("IN_TRANSIT and OUT_FOR_DELIVERY are two different statuses on the same coarse spine", () => {
    const inTransit = courierLabel(projectDayDisplayStatus(task("IN_TRANSIT", "IN_TRANSIT"), [], ANY_DATE));
    const ofd = courierLabel(projectDayDisplayStatus(task("IN_TRANSIT", "OUT_FOR_DELIVERY"), [], ANY_DATE));
    expect(inTransit).not.toBe(ofd);
  });

  it("ASSIGNED / PICKED_UP / HUB_TRANSFER each render their own distinct label (no 'Scheduled' fold)", () => {
    const labels = (["ASSIGNED", "PICKED_UP", "HUB_TRANSFER"] as CourierStatus[]).map((cs) =>
      courierLabel(projectDayDisplayStatus(task("IN_TRANSIT", cs), [], ANY_DATE)),
    );
    expect(new Set(labels).size).toBe(3);
    expect(labels).not.toContain("Scheduled");
  });

  it("each failure-family state renders its own label (FAILED / PROCESS_FOR_RETURN / RETURNED_TO_SHIPPER)", () => {
    const labels = (["FAILED", "PROCESS_FOR_RETURN", "RETURNED_TO_SHIPPER"] as CourierStatus[]).map((cs) =>
      courierLabel(projectDayDisplayStatus(task("FAILED", cs), [], ANY_DATE)),
    );
    expect(new Set(labels).size).toBe(3);
  });

  it("ARRIVED_AT_DC renders the operator label 'Arrived in DC' (Love's term)", () => {
    expect(courierLabel(projectDayDisplayStatus(task("IN_TRANSIT", "ARRIVED_AT_DC"), [], ANY_DATE))).toBe(
      "Arrived in DC",
    );
  });
});

describe("projectDayDisplayStatus — NULL courier_status falls back to the coarse map (no 'Scheduled' fold)", () => {
  it("coarse CREATED (NULL courier) renders 'Created', not 'Scheduled'", () => {
    const label = courierLabel(projectDayDisplayStatus(task("CREATED", null), [], ANY_DATE));
    expect(label).toBe("Created");
    expect(label).not.toBe("Scheduled");
  });

  it("coarse ASSIGNED (NULL courier) renders 'Assigned', not 'Scheduled'", () => {
    expect(courierLabel(projectDayDisplayStatus(task("ASSIGNED", null), [], ANY_DATE))).toBe("Assigned");
  });

  it("coarse ON_HOLD (NULL courier) renders label-neutral '—' (D57 Item C), not a status word", () => {
    const label = courierLabel(projectDayDisplayStatus(task("ON_HOLD", null), [], ANY_DATE));
    expect(label).toBe("—");
    expect(label).not.toMatch(/hold|scheduled|retry|awaiting/i);
  });

  it("the three previously-folded coarse states are now three distinct labels", () => {
    const created = courierLabel(projectDayDisplayStatus(task("CREATED", null), [], ANY_DATE));
    const assigned = courierLabel(projectDayDisplayStatus(task("ASSIGNED", null), [], ANY_DATE));
    const onHold = courierLabel(projectDayDisplayStatus(task("ON_HOLD", null), [], ANY_DATE));
    expect(new Set([created, assigned, onHold]).size).toBe(3);
  });

  it("a fine courier_status wins over the coarse fallback when both are present", () => {
    // Coarse IN_TRANSIT + fine PICKED_UP → renders the fine label.
    expect(courierLabel(projectDayDisplayStatus(task("IN_TRANSIT", "PICKED_UP"), [], ANY_DATE))).toBe(
      "Picked up",
    );
  });
});

describe("filterTasksByCourierStatus — calendar filter aligned to the rendered status (D57 OQ-5)", () => {
  // The calendar renders each task via resolveCourierDisplay(courier, internal):
  // the FINE courier_status when present, else the COARSE internal_status. The
  // filter mirrors that resolution exactly — the client twin of the server-side
  // buildCourierStatusFilter — so "what you can filter" == "what you see".
  const ofd = task("IN_TRANSIT", "OUT_FOR_DELIVERY"); // fine present → renders "Out for delivery"
  const nullInTransit = task("IN_TRANSIT", null); // pre-backfill → renders coarse "In transit"
  const nullCreated = task("CREATED", null); // coarse-only → renders "Created"
  const nullSkipped = task("SKIPPED", null); // coarse-only → SKIPPED overlay
  const nullOnHold = task("ON_HOLD", null); // legacy → label-neutral "—"
  const all = [ofd, nullInTransit, nullCreated, nullSkipped, nullOnHold];

  it("returns the list unchanged for the null (All) filter", () => {
    expect(filterTasksByCourierStatus(all, null)).toBe(all);
  });

  it("matches a row by its FINE courier_status when present", () => {
    expect(filterTasksByCourierStatus(all, "OUT_FOR_DELIVERY")).toEqual([ofd]);
  });

  it("matches a NULL-courier row by its COARSE internal_status (D57 OQ-5 alignment — no longer All-only)", () => {
    // Pre-#562 this returned [] (OQ-5 forward-only). Love's Day-57 OQ-5 ruling
    // aligns the calendar to the filter: the NULL-courier row that RENDERS
    // "In transit" is now matched by the IN_TRANSIT filter, just like /tasks.
    expect(filterTasksByCourierStatus(all, "IN_TRANSIT")).toEqual([nullInTransit]);
  });

  it("matches coarse-only CREATED and SKIPPED rows (NULL courier) via the fallback", () => {
    expect(filterTasksByCourierStatus(all, "CREATED")).toEqual([nullCreated]);
    expect(filterTasksByCourierStatus(all, "SKIPPED")).toEqual([nullSkipped]);
  });

  it("ON_HOLD is filter-invisible — matches nothing even for a legacy ON_HOLD row (D57 Item C parity)", () => {
    expect(filterTasksByCourierStatus(all, "ON_HOLD")).toEqual([]);
  });

  it("returns empty when no row matches", () => {
    expect(filterTasksByCourierStatus(all, "FAILED")).toEqual([]);
  });
});

describe("dayCellVisual", () => {
  it("normalises an overlay projection to its DAY_DISPLAY_VISUALS label + classes", () => {
    const visual = dayCellVisual({ kind: "exception", status: "APPENDED" });
    expect(visual.label).toBe("Appended");
    expect(visual.classes).toContain("text-green");
  });

  it("normalises a courier projection to the fine pill label + class", () => {
    const projection = projectDayDisplayStatus(task("DELIVERED", "DELIVERED"), [], ANY_DATE)!;
    const visual = dayCellVisual(projection);
    expect(visual.label).toBe("Delivered");
    expect(visual.classes).toContain("text-green");
  });
});
