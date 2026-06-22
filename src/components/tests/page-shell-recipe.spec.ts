// Phase 9 Step 3.1 — page-shell-recipe locks the one shared width (Gap E / D3).

import { describe, expect, it } from "vitest";

import { detailGridClass, shellClass } from "@/components/page-shell-recipe";

describe("page-shell-recipe — one shared content width (Gap E)", () => {
  it("centers with the single canonical max-width", () => {
    expect(shellClass()).toContain("max-w-[75rem]");
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
