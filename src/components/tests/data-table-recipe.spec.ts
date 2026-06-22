import { describe, expect, it } from "vitest";

import {
  TABLE,
  TABLE_CARD,
  TABLE_SCROLL,
  gutterTdClass,
  gutterThClass,
  tdClass,
  thClass,
  type DataTableDensity,
} from "../data-table-recipe";

// Phase 9 · Step 3.4 — the shared <DataTable> recipe (Gap C).
//
// One dense floating-card table skinned to Direction B+. These tests LOCK the
// header/cell geometry, the never-wrap + truncate invariants, the mono-figure
// rule, and the status-LED gutter colours, so the table can't silently re-drift
// back into the 14 hand-rolled variants the Step-1 audit found.

function classSet(s: string): Set<string> {
  return new Set(s.split(/\s+/).filter(Boolean));
}

describe("structural class constants", () => {
  it("card is a clipped floating B+ surface in the body face", () => {
    const c = classSet(TABLE_CARD);
    expect(c.has("overflow-hidden")).toBe(true);
    expect(c.has("rounded-2xl")).toBe(true);
    expect(c.has("bg-[color:var(--color-b-card)]")).toBe(true);
    expect(c.has("font-b-body")).toBe(true);
    expect(c.has("shadow-[var(--shadow-b-card)]")).toBe(true);
  });

  it("scroll wrapper contains overflow on narrow viewports", () => {
    expect(classSet(TABLE_SCROLL).has("overflow-x-auto")).toBe(true);
  });

  it("table collapses borders full-width", () => {
    const c = classSet(TABLE);
    expect(c.has("w-full")).toBe(true);
    expect(c.has("border-collapse")).toBe(true);
  });
});

describe("thClass", () => {
  it("never wraps; uppercase eyebrow; comfortable padding by default", () => {
    const c = classSet(thClass("comfortable"));
    expect(c.has("whitespace-nowrap")).toBe(true);
    expect(c.has("uppercase")).toBe(true);
    expect(c.has("text-left")).toBe(true);
    expect(c.has("px-4")).toBe(true);
    expect(c.has("py-3")).toBe(true);
    expect(c.has("border-b")).toBe(true);
  });

  it("right alignment + compact density", () => {
    const c = classSet(thClass("compact", "right"));
    expect(c.has("text-right")).toBe(true);
    expect(c.has("px-3.5")).toBe(true);
    expect(c.has("py-2.5")).toBe(true);
  });
});

describe("tdClass", () => {
  it("truncates by default (nowrap + ellipsis + max-width)", () => {
    const c = classSet(tdClass("comfortable"));
    expect(c.has("whitespace-nowrap")).toBe(true);
    expect(c.has("overflow-hidden")).toBe(true);
    expect(c.has("text-ellipsis")).toBe(true);
    expect(c.has("max-w-[230px]")).toBe(true);
    expect(c.has("h-[54px]")).toBe(true);
  });

  it("compact density sets the 38px row height", () => {
    expect(classSet(tdClass("compact")).has("h-[38px]")).toBe(true);
  });

  it("mono cells use the B+ mono face + tabular figures", () => {
    const c = classSet(tdClass("comfortable", "right", true));
    expect(c.has("font-b-mono")).toBe(true);
    expect(c.has("tabular-nums")).toBe(true);
    expect(c.has("text-right")).toBe(true);
  });

  it("non-mono cells carry neither the mono face nor tabular-nums", () => {
    const c = classSet(tdClass("comfortable", "left", false));
    expect(c.has("font-b-mono")).toBe(false);
    expect(c.has("tabular-nums")).toBe(false);
  });

  it("appends caller treatment (e.g. a name cell's display face)", () => {
    expect(classSet(tdClass("comfortable", "left", false, "font-b-display")).has("font-b-display")).toBe(
      true,
    );
  });
});

describe("status-LED gutter", () => {
  it("the gutter column is a 4px, zero-padding rail", () => {
    expect(classSet(gutterThClass()).has("w-1")).toBe(true);
    expect(classSet(gutterThClass()).has("p-0")).toBe(true);
    expect(classSet(gutterTdClass("active")).has("w-1")).toBe(true);
    expect(classSet(gutterTdClass("active")).has("p-0")).toBe(true);
  });

  it("each tone lights its own LED colour", () => {
    expect(gutterTdClass("active")).toContain("bg-[color:var(--color-led-active)]");
    expect(gutterTdClass("paused")).toContain("bg-[color:var(--color-led-paused)]");
    expect(gutterTdClass("risk")).toContain("bg-[color:var(--color-led-risk)]");
    expect(gutterTdClass("ended")).toContain("bg-[color:var(--color-led-ended)]");
    expect(gutterTdClass("new")).toContain("bg-[color:var(--color-led-new)]");
  });
});

describe("hygiene", () => {
  it("emits no double/edge whitespace", () => {
    const densities: DataTableDensity[] = ["comfortable", "compact"];
    for (const d of densities) {
      for (const out of [thClass(d), tdClass(d), tdClass(d, "right", true)]) {
        expect(out).toBe(out.trim());
        expect(out).not.toMatch(/\s{2,}/);
      }
    }
  });
});
