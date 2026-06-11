// Day-22n PR-C-B — Spec for the CalendarViewToggle `hrefFor` URL
// builder. Pure-fn coverage; React render assertions deferred per
// memory/followup_client_component_test_infra.md.

import { describe, expect, it } from "vitest";

import { hrefFor } from "../CalendarViewToggle";

const baseAnchors = {
  weekAnchor: "2026-05-11",
  monthAnchor: "2026-05-01",
  dayAnchor: "2026-05-15",
} as const;

describe("hrefFor (CalendarViewToggle)", () => {
  it("builds the week-view URL anchored to weekAnchor", () => {
    expect(hrefFor({ view: "week", ...baseAnchors })).toBe(
      "/calendar?view=week&week=2026-05-11",
    );
  });
  it("builds the month-view URL anchored to monthAnchor", () => {
    expect(hrefFor({ view: "month", ...baseAnchors })).toBe(
      "/calendar?view=month&month=2026-05-01",
    );
  });
  it("builds the day-view URL anchored to dayAnchor", () => {
    expect(hrefFor({ view: "day", ...baseAnchors })).toBe(
      "/calendar?view=day&date=2026-05-15",
    );
  });
  it("appends preservedQuery when provided", () => {
    expect(
      hrefFor({
        view: "week",
        ...baseAnchors,
        preservedQuery: "q=sarah&crm=HIGH_RISK",
      }),
    ).toBe("/calendar?view=week&week=2026-05-11&q=sarah&crm=HIGH_RISK");
  });
  it("omits the preservedQuery separator when empty", () => {
    expect(
      hrefFor({ view: "month", ...baseAnchors, preservedQuery: "" }),
    ).toBe("/calendar?view=month&month=2026-05-01");
  });
  it("does not encode the URL twice (preservedQuery passes through verbatim)", () => {
    // Caller is responsible for URL-encoding the preservedQuery
    // segment; the toggle does not double-encode.
    const result = hrefFor({
      view: "day",
      ...baseAnchors,
      preservedQuery: "q=hello%20world",
    });
    expect(result).toContain("q=hello%20world");
  });
});
