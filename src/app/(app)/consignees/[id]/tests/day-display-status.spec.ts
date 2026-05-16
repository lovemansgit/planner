// Day-20 §3.3.3 — DayDisplayStatus projection unit tests.
//
// Covers the projection precedence rules + all 8 task-internal-status
// enum branches per brief §3.3.3 line 485 + DECISION-2 (ii) ruling at
// memory/plans/day-20-consignee-detail-calendar-survey.md, plus the
// task-level SKIPPED branch added Day-28 to close the production
// TypeError surfaced post-cc811d8 promote.
//
// Branches:
//   1. no-task + skip exception → SKIPPED
//   2. no-task + no exception → null (empty cell)
//   3. task + append exception → APPENDED (overrides task.internalStatus)
//   4. task DELIVERED → DELIVERED
//   5. task IN_TRANSIT → OUT_FOR_DELIVERY
//   6. task ASSIGNED | CREATED | ON_HOLD → SCHEDULED
//   7. task FAILED → FAILED
//   8. task CANCELED → CANCELED (renders muted+strikethrough on cell;
//      excluded from legend per Day-20 ruling)
//   9. task SKIPPED → SKIPPED (Day-28 fix; covers 0019 enum extension)

import { describe, expect, it } from "vitest";

import type { SubscriptionException } from "@/modules/subscription-exceptions";
import type { Task, TaskInternalStatus } from "@/modules/tasks/types";

import { projectDayDisplayStatus } from "../_components/DayDisplayStatus";

const ANY_DATE = "2026-05-15";

/** Minimal Task fixture — only the field projectDayDisplayStatus reads. */
function task(internalStatus: TaskInternalStatus): Task {
  return { internalStatus } as unknown as Task;
}

/** Minimal SubscriptionException fixture for the two type variants the
 * projection inspects. */
function exception(
  type: SubscriptionException["type"],
  startDate: string,
): SubscriptionException {
  return { type, startDate } as unknown as SubscriptionException;
}

describe("projectDayDisplayStatus", () => {
  it("returns SKIPPED when no task and a skip exception falls on the date", () => {
    const exceptions = [exception("skip", ANY_DATE)];
    expect(projectDayDisplayStatus(null, exceptions, ANY_DATE)).toBe("SKIPPED");
  });

  it("returns null when no task and no exception falls on the date", () => {
    expect(projectDayDisplayStatus(null, [], ANY_DATE)).toBeNull();
  });

  it("returns null when no task and only an unrelated-date skip exception exists", () => {
    const exceptions = [exception("skip", "2026-05-16")];
    expect(projectDayDisplayStatus(null, exceptions, ANY_DATE)).toBeNull();
  });

  it("returns APPENDED when task exists and an append-without-skip exception matches the date", () => {
    const exceptions = [exception("append_without_skip", ANY_DATE)];
    expect(projectDayDisplayStatus(task("DELIVERED"), exceptions, ANY_DATE)).toBe(
      "APPENDED",
    );
  });

  it("returns DELIVERED when task is DELIVERED with no exceptions", () => {
    expect(projectDayDisplayStatus(task("DELIVERED"), [], ANY_DATE)).toBe("DELIVERED");
  });

  it("returns OUT_FOR_DELIVERY when task is IN_TRANSIT", () => {
    expect(projectDayDisplayStatus(task("IN_TRANSIT"), [], ANY_DATE)).toBe(
      "OUT_FOR_DELIVERY",
    );
  });

  it("returns SCHEDULED when task is ASSIGNED", () => {
    expect(projectDayDisplayStatus(task("ASSIGNED"), [], ANY_DATE)).toBe("SCHEDULED");
  });

  it("returns SCHEDULED when task is CREATED", () => {
    expect(projectDayDisplayStatus(task("CREATED"), [], ANY_DATE)).toBe("SCHEDULED");
  });

  it("returns SCHEDULED when task is ON_HOLD", () => {
    expect(projectDayDisplayStatus(task("ON_HOLD"), [], ANY_DATE)).toBe("SCHEDULED");
  });

  it("returns FAILED when task is FAILED", () => {
    expect(projectDayDisplayStatus(task("FAILED"), [], ANY_DATE)).toBe("FAILED");
  });

  it("returns CANCELED when task is CANCELED", () => {
    expect(projectDayDisplayStatus(task("CANCELED"), [], ANY_DATE)).toBe("CANCELED");
  });

  // Day-28 production fix (digest 4172237023):
  // A task row in internal_status='SKIPPED' (set by addSubscriptionException
  // type='skip' per Day-13 §3.1.1 + migration 0019) was not in the original
  // 7-value TaskInternalStatus union, so the switch fell through to
  // undefined, the `displayStatus === null` guard didn't catch undefined,
  // and DAY_DISPLAY_VISUALS[undefined].label threw a production TypeError
  // on the consignee calendar render path. This case fills the exact
  // coverage gap that hid the drift since Day-13.
  it("returns SKIPPED when task is SKIPPED (task-level skip, post-0019 enum)", () => {
    expect(projectDayDisplayStatus(task("SKIPPED"), [], ANY_DATE)).toBe("SKIPPED");
  });
});
