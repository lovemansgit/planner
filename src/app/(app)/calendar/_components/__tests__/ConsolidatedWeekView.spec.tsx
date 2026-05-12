// Day-22n PR-C-A + Day-23n polish — ConsolidatedWeekView JSX-shape tests.
//
// Uses renderToStaticMarkup against the static HTML output. Targets:
//   - day-cell rendering with 0 and N>0 totals
//   - day cell is a click-through Link to /calendar?view=day&date=<iso>
//   - preservedQuery threading on the drill link
//   - today-highlighting via the --color-tint-navy-subtle backdrop
//   - "No deliveries" empty-state copy (zero days + zero-task days)
//   - HIGH_RISK marker rendered only on flagged days

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ConsolidatedWeekView } from "../ConsolidatedWeekView";
import type { CalendarDayCount } from "../../_types";

const WEEK_START = "2026-05-11"; // Monday
const TODAY = "2026-05-12"; // Tuesday — chosen so the "today" backdrop test is unambiguous

function formatLabel(iso: string) {
  return { weekday: `wk-${iso.slice(8)}`, date: `d-${iso.slice(8)}` };
}

function buildWeek(
  overrides: Partial<Record<string, Partial<CalendarDayCount>>> = {},
): readonly CalendarDayCount[] {
  const dates = [
    "2026-05-11",
    "2026-05-12",
    "2026-05-13",
    "2026-05-14",
    "2026-05-15",
    "2026-05-16",
    "2026-05-17",
  ];
  return dates.map((date) => ({
    date,
    total: 0,
    hasHighRisk: false,
    ...(overrides[date] ?? {}),
  }));
}

describe("ConsolidatedWeekView — empty week", () => {
  it("renders the explicit empty-state copy when days is empty", () => {
    const html = renderToStaticMarkup(
      ConsolidatedWeekView({
        weekStart: WEEK_START,
        days: [],
        today: TODAY,
        formatWeekdayLabel: formatLabel,
      }),
    );
    expect(html).toMatch(/No deliveries this week/);
  });
});

describe("ConsolidatedWeekView — day cell rendering", () => {
  it("renders the No deliveries copy on zero-task days", () => {
    const html = renderToStaticMarkup(
      ConsolidatedWeekView({
        weekStart: WEEK_START,
        days: buildWeek(),
        today: TODAY,
        formatWeekdayLabel: formatLabel,
      }),
    );
    // 7 day cells, all zero-total → 7 "No deliveries" instances.
    expect(html.match(/No deliveries/g)?.length ?? 0).toBeGreaterThanOrEqual(7);
  });

  it("renders the hero count on days with at least 1 task", () => {
    const html = renderToStaticMarkup(
      ConsolidatedWeekView({
        weekStart: WEEK_START,
        days: buildWeek({ "2026-05-12": { total: 5 } }),
        today: TODAY,
        formatWeekdayLabel: formatLabel,
      }),
    );
    expect(html).toMatch(/font-display[^"]*">5</);
  });

  it("does NOT render any task-preview rows (Day-23n removed)", () => {
    const html = renderToStaticMarkup(
      ConsolidatedWeekView({
        weekStart: WEEK_START,
        days: buildWeek({
          "2026-05-12": { total: 5 },
          "2026-05-13": { total: 3 },
        }),
        today: TODAY,
        formatWeekdayLabel: formatLabel,
      }),
    );
    expect(html).not.toMatch(/and \d+ more deliveries/);
    expect(html).not.toMatch(/Pushed to SuiteFleet/);
  });
});

describe("ConsolidatedWeekView — click-through Link (Day-23n)", () => {
  it("renders each day cell as a Link to /calendar?view=day&date=<iso>", () => {
    const html = renderToStaticMarkup(
      ConsolidatedWeekView({
        weekStart: WEEK_START,
        days: buildWeek({ "2026-05-12": { total: 3 } }),
        today: TODAY,
        formatWeekdayLabel: formatLabel,
      }),
    );
    expect(html).toMatch(
      /href="\/calendar\?view=day&(?:amp;)?date=2026-05-12"/,
    );
    expect(html).toMatch(
      /href="\/calendar\?view=day&(?:amp;)?date=2026-05-17"/,
    );
  });

  it("threads preservedQuery into the day-drill href", () => {
    const html = renderToStaticMarkup(
      ConsolidatedWeekView({
        weekStart: WEEK_START,
        days: buildWeek({ "2026-05-12": { total: 1 } }),
        today: TODAY,
        formatWeekdayLabel: formatLabel,
        preservedQuery: "q=khouri&crm=HIGH_RISK",
      }),
    );
    expect(html).toMatch(
      /href="\/calendar\?view=day&(?:amp;)?date=2026-05-12&(?:amp;)?q=khouri&(?:amp;)?crm=HIGH_RISK"/,
    );
  });

  it("emits aria-label for each day cell for keyboard / screen-reader navigation", () => {
    const html = renderToStaticMarkup(
      ConsolidatedWeekView({
        weekStart: WEEK_START,
        days: buildWeek({ "2026-05-12": { total: 1 } }),
        today: TODAY,
        formatWeekdayLabel: formatLabel,
      }),
    );
    expect(html).toMatch(/aria-label="View deliveries on 2026-05-12"/);
  });
});

describe("ConsolidatedWeekView — today highlighting + HIGH_RISK marker", () => {
  it("applies the --color-tint-navy-subtle backdrop only to today's column", () => {
    const html = renderToStaticMarkup(
      ConsolidatedWeekView({
        weekStart: WEEK_START,
        days: buildWeek(),
        today: TODAY,
        formatWeekdayLabel: formatLabel,
      }),
    );
    expect(html).toMatch(/data-day="2026-05-12"[^>]*data-is-today="true"/);
    expect(html).toMatch(/data-day="2026-05-11"[^>]*data-is-today="false"/);
    const todayCellRe = /data-day="2026-05-12"[^>]*--color-tint-navy-subtle/;
    expect(html).toMatch(todayCellRe);
  });

  it("renders the High risk eyebrow only on days with hasHighRisk=true", () => {
    const html = renderToStaticMarkup(
      ConsolidatedWeekView({
        weekStart: WEEK_START,
        days: buildWeek({
          "2026-05-12": { total: 2, hasHighRisk: true },
          "2026-05-13": { total: 1, hasHighRisk: false },
        }),
        today: TODAY,
        formatWeekdayLabel: formatLabel,
      }),
    );
    expect(html).toMatch(/High risk/);
    expect((html.match(/High risk/g) ?? []).length).toBe(1);
  });
});
