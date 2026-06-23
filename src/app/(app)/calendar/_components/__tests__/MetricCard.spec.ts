// Day-22n PR-C-B — Spec for the MetricCard tone-class lookup. Pure-fn
// coverage; React render assertions deferred per
// memory/followup_client_component_test_infra.md.
//
// Phase 10 · Batch B5 — MetricCard now delegates to the shipped B+
// metric-card recipe; the tone lookup returns the recipe's B+ surface
// classes (`--color-b-card` floating surface, `--color-border-default`
// hairline) with the calendar-local `risk` tone mapped to the recipe's
// `alert` attention tone.

import { describe, expect, it } from "vitest";

import { getMetricCardToneClasses } from "../MetricCard";

describe("getMetricCardToneClasses", () => {
  it("returns default tone classes when tone is undefined", () => {
    const classes = getMetricCardToneClasses(undefined);
    expect(classes.card).toContain("bg-[color:var(--color-b-card)]");
    expect(classes.card).toContain("border-[color:var(--color-border-default)]");
    expect(classes.numeral).toBe("text-navy");
  });
  it("returns default tone classes when tone='default'", () => {
    const classes = getMetricCardToneClasses("default");
    expect(classes.card).toContain("bg-[color:var(--color-b-card)]");
    expect(classes.numeral).toBe("text-navy");
  });
  it("maps the 'risk' tone onto the recipe's alert attention tone", () => {
    const classes = getMetricCardToneClasses("risk");
    expect(classes.card).toContain("bg-red/[0.04]");
    expect(classes.card).toContain("border-red/30");
    expect(classes.numeral).toBe("text-red");
  });
  it("default and risk tones use distinct numeral colors", () => {
    expect(getMetricCardToneClasses("default").numeral).not.toBe(
      getMetricCardToneClasses("risk").numeral,
    );
  });
});
