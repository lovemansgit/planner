// Phase 9 Step 3.1 — page-shell-recipe locks the one shared width (Gap E / D3).

import { describe, expect, it } from "vitest";

import { detailGridClass, shellClass, tableBleedClass } from "@/components/page-shell-recipe";

describe("page-shell-recipe — one shared content width (Gap E)", () => {
  it("centers with the single canonical max-width", () => {
    // Phase 12 Batch A — adopted live at the nav's existing 6xl width.
    expect(shellClass()).toContain("max-w-6xl");
    expect(shellClass()).toContain("mx-auto");
  });
  it("appends caller className", () => {
    expect(shellClass("py-10")).toContain("py-10");
  });
});

describe("detailGrid — D3 two-column fill", () => {
  it("fills two columns at md+ instead of a stranded narrow column", () => {
    expect(detailGridClass()).toContain("md:grid-cols-2");
  });
});

describe("tableBleedClass — Item 6 table-region right-bleed", () => {
  it("extends the table right edge into the gutter only at xl+ (zero below)", () => {
    const cls = tableBleedClass();
    // Stepped negative right margin — never a positive/left shift, so the
    // shared left edge is preserved and only the right edge bleeds.
    expect(cls).toContain("xl:-mr-24");
    expect(cls).toContain("2xl:-mr-40");
    expect(cls).not.toContain("ml-");
    expect(cls).not.toContain("mx-");
  });
  it("appends caller className", () => {
    expect(tableBleedClass("mt-4")).toContain("mt-4");
  });
});
