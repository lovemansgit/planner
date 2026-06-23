import { describe, expect, it } from "vitest";

import { windowTrackGeometry } from "../delivery-window-track";

// Phase 9 · Step 3.4 — the delivery-window track geometry (B+ signature).
//
// A delivery window is drawn as a bar on a fixed 06:00→22:00 day baseline so an
// operator reads the day's load as a shape. These tests lock the placement math
// (a 960-minute scale) and the out-of-range clamping, so the bar never escapes
// its track.

const approx = (got: number, want: number) => expect(Math.abs(got - want)).toBeLessThan(0.001);

describe("windowTrackGeometry", () => {
  it("places an early-morning window hard left", () => {
    const g = windowTrackGeometry("06:00:00", "09:00:00");
    approx(g.leftPct, 0);
    approx(g.widthPct, 18.75); // 180 / 960
  });

  it("places a late-afternoon window right of centre", () => {
    const g = windowTrackGeometry("16:00", "18:00");
    approx(g.leftPct, 62.5); // (960-360)/960
    approx(g.widthPct, 12.5); // 120/960
  });

  it("places a midday window mid-track", () => {
    const g = windowTrackGeometry("12:00:00", "14:00:00");
    approx(g.leftPct, 37.5);
    approx(g.widthPct, 12.5);
  });

  it("spans a long all-day window", () => {
    const g = windowTrackGeometry("09:00:00", "21:00:00");
    approx(g.leftPct, 18.75);
    approx(g.widthPct, 75); // (1260-540)/960
  });

  it("clamps a window that starts before the 06:00 baseline", () => {
    const g = windowTrackGeometry("04:00", "07:00");
    approx(g.leftPct, 0);
    approx(g.widthPct, 6.25); // clamped left at 0, right at (420-360)/960
  });

  it("clamps a window that runs past the 22:00 end", () => {
    const g = windowTrackGeometry("21:00", "23:30");
    approx(g.leftPct, 93.75);
    approx(g.widthPct, 6.25); // right clamped to 100
  });

  it("never produces a negative width", () => {
    const g = windowTrackGeometry("23:00", "23:30");
    expect(g.widthPct).toBeGreaterThanOrEqual(0);
    expect(g.leftPct + g.widthPct).toBeLessThanOrEqual(100.001);
  });

  it("returns a zero bar for unparseable input", () => {
    expect(windowTrackGeometry("", "")).toEqual({ leftPct: 0, widthPct: 0 });
    expect(windowTrackGeometry("nonsense", "18:00")).toEqual({ leftPct: 0, widthPct: 0 });
  });
});
