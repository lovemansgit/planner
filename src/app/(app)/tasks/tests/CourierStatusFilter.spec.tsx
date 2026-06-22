// D56 Phase 8 / Lane 3 — fine-14 courier-status filter dropdown.
//
// Replaces the coarse-7 status pills on /tasks (Love ruling: a dropdown of
// all 14 fine states + "All"). URL-state rides the existing ?status= param
// (single param, single filter). Pure server-render (the actions-cell-lock
// idiom); next/navigation hooks are stubbed so the control renders without
// a router context.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { COURIER_STATUS_VALUES } from "@/modules/integration/types";

const searchParamsRef = { current: new URLSearchParams() };

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => searchParamsRef.current,
}));

import { CourierStatusFilter } from "../_components/CourierStatusFilter";

describe("CourierStatusFilter", () => {
  it("lists the 14 fine states + CREATED + SKIPPED plus an 'All' option (D57 Item B)", () => {
    searchParamsRef.current = new URLSearchParams();
    const html = renderToStaticMarkup(<CourierStatusFilter />);
    const optionCount = (html.match(/<option/g) ?? []).length;
    expect(optionCount).toBe(COURIER_STATUS_VALUES.length + 2 + 1); // 14 + CREATED/SKIPPED + All
    expect(html).toContain("All");
    expect(html).toContain("Created");
    expect(html).toContain("Skipped");
    expect(html).not.toContain("On hold"); // ON_HOLD is not a dropdown option
    for (const value of COURIER_STATUS_VALUES) {
      expect(html).toContain(`value="${value}"`);
    }
  });

  it("selects the active fine status from the ?status= param", () => {
    searchParamsRef.current = new URLSearchParams("status=OUT_FOR_DELIVERY");
    const html = renderToStaticMarkup(<CourierStatusFilter />);
    expect(html).toMatch(/<select[^>]*>/);
    // React server-renders the selected option's `selected` attribute.
    expect(html).toMatch(/value="OUT_FOR_DELIVERY"[^>]*selected/);
  });

  it("defaults to no active filter (All) when ?status= is absent", () => {
    searchParamsRef.current = new URLSearchParams();
    const html = renderToStaticMarkup(<CourierStatusFilter />);
    // The empty-value ('All') option is the selected one.
    expect(html).toMatch(/value=""[^>]*selected/);
  });
});
