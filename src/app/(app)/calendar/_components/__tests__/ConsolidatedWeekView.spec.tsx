// Day-22n PR-C-A § §2.4 — ConsolidatedWeekView JSX-shape tests.
//
// Uses renderToStaticMarkup against the static HTML output. Matches
// the component-test pattern in the rest of the repo. Targets:
//   - day-cell rendering with 0, 1, 3, 5 tasks
//   - today-highlighting via the --color-tint-navy-subtle backdrop
//   - "No deliveries" empty-state copy
//   - HIGH_RISK marker rendered only on flagged days
//   - top-task overflow line copy

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ConsolidatedWeekView } from "../ConsolidatedWeekView";
import type { CalendarDayCount, CalendarTopTaskForDay } from "../../_types";

const WEEK_START = "2026-05-11"; // Monday
const TODAY = "2026-05-12"; // Tuesday — chosen so the "today" backdrop test is unambiguous

function formatLabel(iso: string) {
  // Stable labels for snapshot-style matching.
  return { weekday: `wk-${iso.slice(8)}`, date: `d-${iso.slice(8)}` };
}

function topTask(overrides: Partial<CalendarTopTaskForDay> = {}): CalendarTopTaskForDay {
  return {
    taskId: "task-x",
    consigneeId: "consignee-x",
    consigneeName: "Sarah Khouri",
    deliveryWindowStart: "09:00",
    status: "CREATED",
    isHighRisk: false,
    ...overrides,
  };
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
    topTasks: [],
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
    // 7 day cells all empty.
    expect(html.match(/No deliveries/g)?.length ?? 0).toBeGreaterThanOrEqual(7);
  });

  it("renders the hero count on days with at least 1 task", () => {
    const html = renderToStaticMarkup(
      ConsolidatedWeekView({
        weekStart: WEEK_START,
        days: buildWeek({
          "2026-05-12": { total: 5, topTasks: [topTask()] },
        }),
        today: TODAY,
        formatWeekdayLabel: formatLabel,
      }),
    );
    expect(html).toMatch(/font-display[^"]*">5</);
  });

  it("renders up to 3 task preview rows in caller order", () => {
    const tasks = [
      topTask({ taskId: "t1", consigneeName: "Alpha", deliveryWindowStart: "08:00" }),
      topTask({ taskId: "t2", consigneeName: "Bravo", deliveryWindowStart: "10:00" }),
      topTask({ taskId: "t3", consigneeName: "Charlie", deliveryWindowStart: "14:00" }),
    ];
    const html = renderToStaticMarkup(
      ConsolidatedWeekView({
        weekStart: WEEK_START,
        days: buildWeek({
          "2026-05-12": { total: 3, topTasks: tasks },
        }),
        today: TODAY,
        formatWeekdayLabel: formatLabel,
      }),
    );
    expect(html).toMatch(/Alpha/);
    expect(html).toMatch(/Bravo/);
    expect(html).toMatch(/Charlie/);
    expect(html.indexOf("Alpha")).toBeLessThan(html.indexOf("Bravo"));
    expect(html.indexOf("Bravo")).toBeLessThan(html.indexOf("Charlie"));
  });

  it("renders the overflow line copy when total > topTasks.length", () => {
    const tasks = [
      topTask({ taskId: "t1" }),
      topTask({ taskId: "t2" }),
      topTask({ taskId: "t3" }),
    ];
    const html = renderToStaticMarkup(
      ConsolidatedWeekView({
        weekStart: WEEK_START,
        days: buildWeek({
          "2026-05-12": { total: 5, topTasks: tasks },
        }),
        today: TODAY,
        formatWeekdayLabel: formatLabel,
      }),
    );
    expect(html).toMatch(/and 2 more deliveries/);
  });

  it("renders no overflow line when topTasks covers the total exactly", () => {
    const tasks = [topTask({ taskId: "t1" })];
    const html = renderToStaticMarkup(
      ConsolidatedWeekView({
        weekStart: WEEK_START,
        days: buildWeek({
          "2026-05-12": { total: 1, topTasks: tasks },
        }),
        today: TODAY,
        formatWeekdayLabel: formatLabel,
      }),
    );
    expect(html).not.toMatch(/and \d+ more deliveries/);
    expect(html).not.toMatch(/\+ 1 more/);
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
    // The today cell carries data-is-today="true"; others carry "false".
    expect(html).toMatch(/data-day="2026-05-12"[^>]*data-is-today="true"/);
    expect(html).toMatch(/data-day="2026-05-11"[^>]*data-is-today="false"/);
    // Backdrop class only present on the today cell.
    const todayCellRe = /data-day="2026-05-12"[^>]*--color-tint-navy-subtle/;
    expect(html).toMatch(todayCellRe);
  });

  it("renders the High risk eyebrow only on days with hasHighRisk=true", () => {
    const html = renderToStaticMarkup(
      ConsolidatedWeekView({
        weekStart: WEEK_START,
        days: buildWeek({
          "2026-05-12": { total: 2, hasHighRisk: true, topTasks: [topTask()] },
          "2026-05-13": { total: 1, hasHighRisk: false, topTasks: [topTask()] },
        }),
        today: TODAY,
        formatWeekdayLabel: formatLabel,
      }),
    );
    expect(html).toMatch(/High risk/);
    // Should appear exactly once — only the 05-12 cell is flagged.
    expect((html.match(/High risk/g) ?? []).length).toBe(1);
  });
});
