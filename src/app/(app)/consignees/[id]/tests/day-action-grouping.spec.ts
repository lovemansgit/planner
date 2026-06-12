// #430 click-reduction — day-popover action grouping.
//
// Locks the spec: which action belongs to which always-visible section
// (Edit delivery vs Reschedule). The "View" section is the read-only
// timeline button, rendered separately from buildActions. Pure-data
// test (no React render harness in this repo).

import { describe, expect, it } from "vitest";

import {
  buildActions,
  MUTATION_ELIGIBLE_STATUSES,
  type ActionGroup,
  type CalendarActionPermissions,
} from "../_components/day-actions";

const ALL_PERMS: CalendarActionPermissions = {
  canSkip: true,
  canSkipOverride: true,
  canPause: true,
  canChangeAddressOneOff: true,
  canChangeAddressForward: true,
  canAddNote: true,
  canViewTimeline: true,
};

// A subscription-backed CREATED task makes every mutation action visible.
const actions = buildActions(ALL_PERMS, "sub-1", "CREATED");

const groupOf = (mode: string): ActionGroup | undefined =>
  actions.find((a) => a.mode === mode)?.group;

describe("#430 day-popover action grouping", () => {
  it("groups the note + address overrides under Edit delivery", () => {
    expect(groupOf("add-note")).toBe("edit");
    expect(groupOf("addr-one-off")).toBe("edit");
    expect(groupOf("addr-forward")).toBe("edit");
  });

  it("groups skip / pause / cancel under Reschedule", () => {
    expect(groupOf("skip")).toBe("reschedule");
    expect(groupOf("skip-override")).toBe("reschedule");
    expect(groupOf("pause")).toBe("reschedule");
    expect(groupOf("cancel-no-append")).toBe("reschedule");
  });

  it("assigns every action a group (no ungrouped action)", () => {
    for (const action of actions) {
      expect(action.group === "edit" || action.group === "reschedule").toBe(true);
    }
  });
});

// -----------------------------------------------------------------------------
// R-A — assignment gate on the popover (plan §4.1)
// -----------------------------------------------------------------------------

describe("R-A — driver-bound days lock mutations; driver notes survive (site-4 ruling)", () => {
  it("ASSIGNED: every mutation action is hidden EXCEPT add-note (a note is communication)", () => {
    const assigned = buildActions(ALL_PERMS, "sub-1", "ASSIGNED");
    const mutations = assigned.filter((a) => a.mode !== "add-note");
    expect(mutations.every((a) => !a.visible)).toBe(true);
    expect(assigned.find((a) => a.mode === "add-note")?.visible).toBe(true);
  });

  it("IN_TRANSIT: same lock as ASSIGNED; add-note survives", () => {
    const inTransit = buildActions(ALL_PERMS, "sub-1", "IN_TRANSIT");
    const mutations = inTransit.filter((a) => a.mode !== "add-note");
    expect(mutations.every((a) => !a.visible)).toBe(true);
    expect(inTransit.find((a) => a.mode === "add-note")?.visible).toBe(true);
  });

  it("terminal statuses hide everything including add-note", () => {
    const delivered = buildActions(ALL_PERMS, "sub-1", "DELIVERED");
    expect(delivered.every((a) => !a.visible)).toBe(true);
  });

  it("MUTATION_ELIGIBLE_STATUSES no longer contains ASSIGNED", () => {
    expect(MUTATION_ELIGIBLE_STATUSES.has("ASSIGNED")).toBe(false);
    expect(MUTATION_ELIGIBLE_STATUSES.has("CREATED")).toBe(true);
    expect(MUTATION_ELIGIBLE_STATUSES.has("ON_HOLD")).toBe(true);
  });
});
