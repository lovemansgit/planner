import { describe, expect, it } from "vitest";

import { badgeClass, type BadgeSize } from "../badge-recipe";

// The shared <Badge> shell (audit finding 3) carries one invariant treatment
// and two real geometries that exist in the operator UI:
//   - md: the /tasks status pill (#458) — px-2.5 py-1 text-xs, gap for icon+label
//   - sm: the DayActionPopover dialog badges — rounded-sm px-2 py-0.5 text-[10px]
// These tests LOCK both recipes so a future edit can't silently re-drift them.

function classSet(s: string): Set<string> {
  return new Set(s.split(/\s+/).filter(Boolean));
}

const INVARIANT = ["inline-flex", "items-center", "font-medium", "uppercase", "tracking-[0.1em]"];

describe("badgeClass", () => {
  it("md default reproduces the #458 /tasks status-pill class set exactly", () => {
    const got = classSet(badgeClass("md"));
    const expected = new Set([
      ...INVARIANT,
      "gap-1.5",
      "px-2.5",
      "py-1",
      "text-xs",
    ]);
    expect(got).toEqual(expected);
  });

  it("sm reproduces the DayActionPopover dialog-badge recipe exactly", () => {
    const got = classSet(badgeClass("sm"));
    const expected = new Set([
      ...INVARIANT,
      "rounded-sm",
      "px-2",
      "py-0.5",
      "text-[10px]",
    ]);
    expect(got).toEqual(expected);
  });

  it("defaults to md when size is omitted", () => {
    expect(classSet(badgeClass())).toEqual(classSet(badgeClass("md")));
  });

  it("appends caller colour/treatment classes", () => {
    const got = classSet(badgeClass("sm", "bg-amber-100 text-amber-deep"));
    expect(got.has("bg-amber-100")).toBe(true);
    expect(got.has("text-amber-deep")).toBe(true);
  });

  it("emits no leading/trailing/double whitespace when className is empty", () => {
    const out = badgeClass("md", "");
    expect(out).toBe(out.trim());
    expect(out).not.toMatch(/\s{2,}/);
  });

  it("covers exactly the two real sizes", () => {
    const sizes: BadgeSize[] = ["md", "sm"];
    for (const s of sizes) expect(badgeClass(s).length).toBeGreaterThan(0);
  });
});
