// Phase 12.2 Batch A · FIX 2a — page-size dropdown URL discipline.
//
// The operator /tasks page-size control rebuilt a FRESH URLSearchParams and
// copied only status + perPage, silently dropping from / to / q — so changing
// the page size reset the date range to today (and lost the search). Every
// sibling control (CourierStatusFilter, SearchBar, DateRangeFilter, the admin
// AdminPageSizeDropdown) clones the existing params. buildPageSizeUrl now clones
// too. Pure-helper coverage per the codebase's no-render convention.

import { describe, expect, it } from "vitest";

import { buildPageSizeUrl } from "../page-size-dropdown";
import { PAGE_SIZE_DEFAULT } from "../status";

describe("buildPageSizeUrl — preserves sibling filters (FIX 2a)", () => {
  it("preserves from / to / q when changing page size (was dropped pre-fix)", () => {
    const params = new URLSearchParams(
      "status=DELIVERED&from=2026-04-16&to=2026-05-15&q=sarah",
    );
    const url = buildPageSizeUrl(params, 100);
    expect(url).toContain("from=2026-04-16");
    expect(url).toContain("to=2026-05-15");
    expect(url).toContain("q=sarah");
    expect(url).toContain("status=DELIVERED");
    expect(url).toContain("perPage=100");
  });

  it("a 50→100 change keeps the 30-day range intact end-to-end", () => {
    // The exact UAT repro: a 30-day window + 50/page, change to 100/page.
    const params = new URLSearchParams("from=2026-04-16&to=2026-05-15&perPage=50");
    const url = buildPageSizeUrl(params, 100);
    const qs = new URLSearchParams(url.split("?")[1] ?? "");
    expect(qs.get("from")).toBe("2026-04-16");
    expect(qs.get("to")).toBe("2026-05-15");
    expect(qs.get("perPage")).toBe("100");
  });

  it("drops the page param on size change (page-N is meaningless at a new size)", () => {
    const params = new URLSearchParams("page=7&from=2026-04-16&to=2026-05-15");
    const url = buildPageSizeUrl(params, 100);
    expect(url).not.toContain("page=7");
    expect(url).toContain("from=2026-04-16");
  });

  it("omits perPage when selecting the default size (clean bookmark URLs)", () => {
    const params = new URLSearchParams("from=2026-04-16&to=2026-05-15&perPage=100");
    const url = buildPageSizeUrl(params, PAGE_SIZE_DEFAULT);
    expect(url).not.toContain("perPage=");
    expect(url).toContain("from=2026-04-16");
    expect(url).toContain("to=2026-05-15");
  });

  it("returns the bare path when no params remain", () => {
    expect(buildPageSizeUrl(new URLSearchParams(), PAGE_SIZE_DEFAULT)).toBe("/tasks");
  });
});
