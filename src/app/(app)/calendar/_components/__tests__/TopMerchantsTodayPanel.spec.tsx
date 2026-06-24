// Day-23n fleet panels — TopMerchantsTodayPanel JSX-shape spec.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TopMerchantsTodayPanel } from "../TopMerchantsTodayPanel";
import type { CalendarTopMerchantToday } from "../../_types";

const SAMPLE: readonly CalendarTopMerchantToday[] = [
  { tenantId: "t1", tenantName: "MPL", tenantSlug: "mpl", taskCount: 42 },
  { tenantId: "t2", tenantName: "DNR", tenantSlug: "dnr", taskCount: 18 },
  { tenantId: "t3", tenantName: "FBU", tenantSlug: "fresh-butchers", taskCount: 7 },
];

describe("TopMerchantsTodayPanel", () => {
  it("renders the panel header copy", () => {
    const html = renderToStaticMarkup(TopMerchantsTodayPanel({ merchants: SAMPLE }));
    expect(html).toMatch(/Top merchants today/);
    expect(html).toMatch(/Ranked by task volume/);
  });

  it("renders an empty-state message when no merchants are present", () => {
    const html = renderToStaticMarkup(TopMerchantsTodayPanel({ merchants: [] }));
    expect(html).toMatch(/No deliveries scheduled across any merchant today/);
  });

  it("renders one row per merchant in caller order with rank prefix", () => {
    const html = renderToStaticMarkup(TopMerchantsTodayPanel({ merchants: SAMPLE }));
    expect(html.indexOf("MPL")).toBeLessThan(html.indexOf("DNR"));
    expect(html.indexOf("DNR")).toBeLessThan(html.indexOf("FBU"));
    expect(html).toMatch(/01/);
    expect(html).toMatch(/02/);
    expect(html).toMatch(/03/);
  });

  it("renders the task count for each merchant", () => {
    const html = renderToStaticMarkup(TopMerchantsTodayPanel({ merchants: SAMPLE }));
    expect(html).toMatch(/>42</);
    expect(html).toMatch(/>18</);
    expect(html).toMatch(/>7</);
  });

  // Phase 12.2 FIX 4 (extension) — the drill-down key MUST be `merchant`, the
  // key /admin/tasks reads (admin/tasks/page.tsx: `params.merchant`). The sibling
  // PerMerchantBreakdownPanel was aligned in the original Fix 4, but this panel —
  // rendered directly above it on the same admin Overview — still emitted the
  // stale `?merchantSlug=` key, which the admin tasks page silently ignores, so
  // its drill-downs dropped the filter and showed ALL merchants.
  it("links each row to /admin/tasks?merchant=<slug> with encoded slug", () => {
    const html = renderToStaticMarkup(TopMerchantsTodayPanel({ merchants: SAMPLE }));
    expect(html).toMatch(/href="\/admin\/tasks\?merchant=mpl"/);
    expect(html).toMatch(/href="\/admin\/tasks\?merchant=dnr"/);
    expect(html).toMatch(/href="\/admin\/tasks\?merchant=fresh-butchers"/);
  });

  it("does NOT emit the stale ?merchantSlug= key (the dropped-filter bug)", () => {
    const html = renderToStaticMarkup(TopMerchantsTodayPanel({ merchants: SAMPLE }));
    expect(html).not.toMatch(/merchantSlug=/);
  });
});
