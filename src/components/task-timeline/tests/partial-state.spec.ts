// R6.3 (Day-53 R6-part-2) — partial-state banner guard.
//
// Pure-logic test (no React render harness in this repo). Locks the
// Love-ruled verbatim banner copy and the opt-in null-AWB predicate.

import { describe, expect, it } from "vitest";

import { TASK_AWAITING_PUSH_BANNER, isAwaitingPush } from "../partial-state";

describe("R6.3 task-timeline partial-state banner", () => {
  it("uses the Love-ruled verbatim copy (do not paraphrase)", () => {
    expect(TASK_AWAITING_PUSH_BANNER).toBe(
      "Task not yet pushed to SuiteFleet — AWB will be assigned once dispatch completes.",
    );
  });

  it("shows the banner when the AWB is null (task not yet pushed)", () => {
    expect(isAwaitingPush(null)).toBe(true);
  });

  it("hides the banner when an AWB is present", () => {
    expect(isAwaitingPush("MPL-80355079")).toBe(false);
  });

  it("hides the banner when the caller did not opt in (undefined)", () => {
    expect(isAwaitingPush(undefined)).toBe(false);
  });
});
