// Day-22n PR-C-B — Spec for the MetricCard tone-class lookup. Pure-fn
// coverage; React render assertions deferred per
// memory/followup_client_component_test_infra.md.

import { describe, expect, it } from "vitest";

import { getMetricCardToneClasses } from "../MetricCard";

describe("getMetricCardToneClasses", () => {
  it("returns default tone classes when tone is undefined", () => {
    const classes = getMetricCardToneClasses(undefined);
    expect(classes.card).toContain("border-stone-200");
    expect(classes.card).toContain("bg-surface-primary");
    expect(classes.numeral).toBe("text-navy");
  });
  it("returns default tone classes when tone='default'", () => {
    const classes = getMetricCardToneClasses("default");
    expect(classes.card).toContain("border-stone-200");
    expect(classes.numeral).toBe("text-navy");
  });
  it("returns risk tone classes for tone='risk'", () => {
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
