import { describe, expect, it } from "vitest";

import {
  METRIC_GRID,
  METRIC_LABEL,
  METRIC_VALUE,
  metricToneClass,
  type MetricTone,
} from "../metric-card-recipe";

// Phase 9 · Step 3.6 — the shared MetricCard recipe (Gap F).
//
// The dashboard metric unit (distinct from the list-count HeroCount). Skinned to
// B+: a floating card with a MONO tabular value (the C-borrow figure rule) and
// two tones — default and `alert` (the "Failed/at-risk" card). These tests lock
// the tone classes, the mono value, and the eyebrow label.

function classSet(s: string): Set<string> {
  return new Set(s.split(/\s+/).filter(Boolean));
}

describe("metricToneClass", () => {
  it("default is the floating B+ card with a navy value", () => {
    const t = metricToneClass("default");
    expect(t.card).toContain("bg-[color:var(--color-b-card)]");
    expect(t.value).toBe("text-navy");
  });

  it("alert tints red for the failed/at-risk card", () => {
    const t = metricToneClass("alert");
    expect(t.card).toContain("border-red/30");
    expect(t.card).toContain("bg-red/[0.04]");
    expect(t.value).toBe("text-red");
  });

  it("defaults to default when omitted", () => {
    expect(metricToneClass()).toEqual(metricToneClass("default"));
  });

  it("the two tones use distinct value colours", () => {
    const tones: MetricTone[] = ["default", "alert"];
    expect(metricToneClass(tones[0]).value).not.toBe(metricToneClass(tones[1]).value);
  });
});

describe("label + value + grid", () => {
  it("the value is the B+ mono tabular figure (not display)", () => {
    const c = classSet(METRIC_VALUE);
    expect(c.has("font-b-mono")).toBe(true);
    expect(c.has("tabular-nums")).toBe(true);
    expect(c.has("font-display")).toBe(false);
  });

  it("the label is a tiny uppercase mono eyebrow (the one allowed uppercase)", () => {
    expect(METRIC_LABEL).toContain("uppercase");
    expect(METRIC_LABEL).toContain("font-b-mono");
  });

  it("the grid is responsive (2 → 3 → 5 columns)", () => {
    const c = classSet(METRIC_GRID);
    expect(c.has("grid")).toBe(true);
    expect(c.has("grid-cols-2")).toBe(true);
    expect(c.has("lg:grid-cols-5")).toBe(true);
  });
});
