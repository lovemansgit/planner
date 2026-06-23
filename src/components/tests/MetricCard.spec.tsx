import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MetricCard, MetricGrid } from "../MetricCard";

// Phase 9 · Step 3.6 — MetricCard render behaviour (Gap F).

describe("MetricCard", () => {
  it("renders label, mono value and sublabel", () => {
    const html = renderToStaticMarkup(
      MetricCard({ label: "Active", value: 188, sublabel: "Currently in your book" }),
    );
    expect(html).toContain("Active");
    expect(html).toContain("188");
    expect(html).toContain("Currently in your book");
    expect(html).toContain("font-b-mono");
  });

  it("alert tone tints red", () => {
    const html = renderToStaticMarkup(MetricCard({ label: "Failed", value: 4, tone: "alert" }));
    expect(html).toContain("text-red");
    expect(html).toContain("bg-red/[0.04]");
  });

  it("omits the sublabel when not given", () => {
    const html = renderToStaticMarkup(MetricCard({ label: "Total", value: 225 }));
    expect(html).toContain("225");
  });
});

describe("MetricGrid", () => {
  it("lays cards out in the responsive grid", () => {
    const html = renderToStaticMarkup(MetricGrid({ children: "[CARDS]" }));
    expect(html).toContain("lg:grid-cols-5");
    expect(html).toContain("[CARDS]");
  });
});
