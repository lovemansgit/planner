// Day-22n PR-C-B — Spec for the CalendarFilterBar URL builder.
// Pure-fn coverage; the React + useRouter / useSearchParams render
// path is deferred per
// memory/followup_client_component_test_infra.md.

import { describe, expect, it } from "vitest";

import type { CalendarFiltersValue } from "../../_types";
import { buildCalendarFiltersUrl } from "../CalendarFilterBar";

function emptyFilters(): CalendarFiltersValue {
  return { q: "", crm: "", district: "", status: "" };
}

describe("buildCalendarFiltersUrl", () => {
  it("returns /calendar with no query when all filters are empty and no other params", () => {
    expect(buildCalendarFiltersUrl(new URLSearchParams(), emptyFilters())).toBe(
      "/calendar",
    );
  });

  it("sets only non-empty filter keys", () => {
    const url = buildCalendarFiltersUrl(new URLSearchParams(), {
      ...emptyFilters(),
      q: "sarah",
      crm: "HIGH_RISK",
    });
    expect(url).toContain("q=sarah");
    expect(url).toContain("crm=HIGH_RISK");
    expect(url).not.toContain("district=");
    expect(url).not.toContain("status=");
  });

  it("preserves non-filter params (view, week, month, date)", () => {
    const current = new URLSearchParams("view=week&week=2026-05-11");
    const url = buildCalendarFiltersUrl(current, {
      ...emptyFilters(),
      q: "khouri",
    });
    expect(url).toContain("view=week");
    expect(url).toContain("week=2026-05-11");
    expect(url).toContain("q=khouri");
  });

  it("clears a previously-set filter when the new value is empty", () => {
    const current = new URLSearchParams("q=old&crm=ACTIVE");
    const url = buildCalendarFiltersUrl(current, {
      ...emptyFilters(),
      crm: "HIGH_RISK", // q is cleared, crm changes
    });
    expect(url).not.toContain("q=");
    expect(url).toContain("crm=HIGH_RISK");
  });

  it("always drops the page param on filter writes", () => {
    const current = new URLSearchParams("page=4&view=week");
    const url = buildCalendarFiltersUrl(current, {
      ...emptyFilters(),
      status: "FAILED",
    });
    expect(url).not.toContain("page=");
    expect(url).toContain("view=week");
    expect(url).toContain("status=FAILED");
  });

  it("handles all four filter keys simultaneously (Day-23n: window dropped)", () => {
    const url = buildCalendarFiltersUrl(new URLSearchParams(), {
      q: "khouri",
      crm: "HIGH_RISK",
      district: "DXB-MARINA",
      status: "FAILED",
    });
    expect(url).toContain("q=khouri");
    expect(url).toContain("crm=HIGH_RISK");
    expect(url).toContain("district=DXB-MARINA");
    expect(url).toContain("status=FAILED");
    expect(url).not.toContain("window=");
  });

  it("URL-encodes special characters in filter values", () => {
    const url = buildCalendarFiltersUrl(new URLSearchParams(), {
      ...emptyFilters(),
      q: "Sarah Khouri",
    });
    expect(url).toContain("q=Sarah+Khouri");
  });

  it("returns /calendar (no trailing ?) when query string is empty after clearing", () => {
    const current = new URLSearchParams("q=old");
    const url = buildCalendarFiltersUrl(current, emptyFilters());
    expect(url).toBe("/calendar");
  });
});
