// Day-22 Phase 1 forms — WeekdaySelector helper + JSX-shape tests.
//
// Helper coverage: pure parse + serialise + defensive filtering.
//
// JSX-shape coverage (Day-22 §3.22 fixup post-Love-walkthrough):
// renderToStaticMarkup is used to assert the static-HTML structure
// without a DOM. Anchors the CSS-driven `has-[:checked]:` pattern
// against future regressions — the previous implementation chose
// className based on React-side `isSelected` which froze the visual
// state at render-time and broke perceived interactivity on click.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  parseSelectedWeekdays,
  WeekdaySelector,
  weekdaysToIsoOrdinals,
} from "../WeekdaySelector";

describe("parseSelectedWeekdays", () => {
  it("returns empty for empty input", () => {
    expect(parseSelectedWeekdays([])).toEqual([]);
  });

  it("preserves all 7 valid keys in ISO order", () => {
    const input = ["fri", "sun", "mon", "wed", "tue", "thu", "sat"];
    expect(parseSelectedWeekdays(input)).toEqual([
      "mon",
      "tue",
      "wed",
      "thu",
      "fri",
      "sat",
      "sun",
    ]);
  });

  it("deduplicates repeated keys", () => {
    expect(parseSelectedWeekdays(["mon", "mon", "wed", "wed"])).toEqual(["mon", "wed"]);
  });

  it("drops invalid string values defensively", () => {
    expect(parseSelectedWeekdays(["mon", "monday", "Sun", "sun"])).toEqual([
      "mon",
      "sun",
    ]);
  });

  it("drops non-string values defensively", () => {
    expect(parseSelectedWeekdays([1, null, undefined, "wed", { day: "thu" }])).toEqual([
      "wed",
    ]);
  });
});

describe("weekdaysToIsoOrdinals", () => {
  it("maps weekday keys to ISO ordinals (Mon=1...Sun=7)", () => {
    expect(weekdaysToIsoOrdinals(["mon", "wed", "fri"])).toEqual([1, 3, 5]);
  });

  it("preserves ISO ordering regardless of input order", () => {
    expect(weekdaysToIsoOrdinals(["sun", "mon"])).toEqual([1, 7]);
  });

  it("returns empty for empty input", () => {
    expect(weekdaysToIsoOrdinals([])).toEqual([]);
  });

  it("handles all 7 days", () => {
    expect(
      weekdaysToIsoOrdinals(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]),
    ).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

// ---------------------------------------------------------------------------
// JSX-shape tests — Day-22 §3.22 fixup post-Love-walkthrough.
// ---------------------------------------------------------------------------
// Regression pins for the perceived-interactivity bug. The fix:
// className uses CSS `has-[:checked]:` modifiers (Tailwind) so the
// visible chip styles react to the descendant checkbox's :checked
// state via pure CSS — no React state involved, visual stays in sync
// with the underlying input regardless of how it got toggled.

describe("<WeekdaySelector /> — JSX shape (CSS-driven selected state)", () => {
  it("renders 7 label-wrapped checkboxes sharing the form name", () => {
    const html = renderToStaticMarkup(WeekdaySelector({ name: "days" }));
    // 7 labels, 7 checkboxes
    expect((html.match(/<label /g) ?? []).length).toBe(7);
    expect((html.match(/type="checkbox"/g) ?? []).length).toBe(7);
    // Shared form name
    expect((html.match(/name="days"/g) ?? []).length).toBe(7);
    // 7 distinct weekday values
    for (const key of ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]) {
      expect(html).toContain(`value="${key}"`);
    }
  });

  it("each label className carries the has-[:checked]: modifiers (CSS-driven state)", () => {
    const html = renderToStaticMarkup(WeekdaySelector({ name: "days" }));
    // Three CSS modifiers must be present for visual to sync with :checked.
    expect((html.match(/has-\[:checked\]:bg-navy/g) ?? []).length).toBeGreaterThanOrEqual(7);
    expect((html.match(/has-\[:checked\]:text-paper/g) ?? []).length).toBeGreaterThanOrEqual(7);
    expect((html.match(/has-\[:checked\]:border-navy/g) ?? []).length).toBeGreaterThanOrEqual(7);
  });

  it("does NOT use static React-computed className based on isSelected (regression pin)", () => {
    // The previous implementation chose between two complete className
    // strings based on `isSelected`. Detect that pattern: there should
    // be exactly ONE className-string template per label (no
    // conditional split). Proxy: count occurrences of the rest-state
    // `border-stone-200` class — should equal 7 (one per label), not
    // 0 (would mean "selected" template won the ternary for all
    // labels) and not 14 (would mean both templates appeared).
    const html = renderToStaticMarkup(
      WeekdaySelector({ name: "days", defaultSelected: ["mon", "tue", "wed"] }),
    );
    expect((html.match(/border-stone-200/g) ?? []).length).toBe(7);
  });

  it("defaultSelected pre-checks the right boxes (uncontrolled defaultChecked)", () => {
    const html = renderToStaticMarkup(
      WeekdaySelector({ name: "days", defaultSelected: ["mon", "wed", "fri"] }),
    );
    // React renders defaultChecked as the HTML `checked` attribute.
    expect((html.match(/checked=""/g) ?? []).length).toBe(3);
    // Verify which inputs got checked by matching each input element
    // self-contained (the attribute order is not stable across React
    // renders, so we match the `<input ... />` boundary and assert on
    // its contents).
    const inputFor = (value: string): string => {
      const re = new RegExp(`<input[^>]*value="${value}"[^>]*/>`);
      return html.match(re)?.[0] ?? "";
    };
    expect(inputFor("mon")).toContain("checked");
    expect(inputFor("wed")).toContain("checked");
    expect(inputFor("fri")).toContain("checked");
    // Negative pin: tue / thu / sat / sun were NOT selected.
    expect(inputFor("tue")).not.toContain("checked");
    expect(inputFor("sat")).not.toContain("checked");
  });

  it("label htmlFor points to the input id (label click toggles the linked checkbox)", () => {
    const html = renderToStaticMarkup(WeekdaySelector({ name: "days" }));
    // groupId pattern: weekday-selector-${name}; each input id is
    // ${groupId}-${weekday-key}.
    expect(html).toContain('for="weekday-selector-days-mon"');
    expect(html).toContain('id="weekday-selector-days-mon"');
    expect(html).toContain('for="weekday-selector-days-sun"');
    expect(html).toContain('id="weekday-selector-days-sun"');
  });

  it("checkbox stays in the visual flow as sr-only (accessible but visually hidden)", () => {
    const html = renderToStaticMarkup(WeekdaySelector({ name: "days" }));
    // The pill text is presented via <span>; the underlying checkbox
    // is sr-only so the visible surface is the label chip while
    // assistive tech still sees the checkbox role.
    expect((html.match(/class="sr-only"/g) ?? []).length).toBeGreaterThanOrEqual(7);
  });

  it("renders the form-error message when error prop is set", () => {
    const html = renderToStaticMarkup(
      WeekdaySelector({
        name: "days",
        error: "Pick at least one delivery day.",
      }),
    );
    expect(html).toContain("Pick at least one delivery day.");
    expect(html).toContain('role="alert"');
  });
});
