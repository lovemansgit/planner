import { describe, expect, it } from "vitest";

import {
  DETAIL_CARD,
  DETAIL_SPINE,
  FIELD_LABEL,
  FIELD_ROW,
  SECTION_LABEL,
  fieldValueClass,
} from "../detail-view-recipe";

// Phase 9 · Step 3.5 — the shared detail-view recipe (Gap D).
//
// One detail system for admin + merchant: a floating B+ card with a navy
// structural spine (never a navy band), a two-column fill (D3), and a single
// FieldRow. These tests lock the invariants that the audit flagged — sentence-
// case labels (D2, killing the uppercase indent divergence), the navy-as-spine
// rule, the mono-figure rule, and the two-column row geometry.

function classSet(s: string): Set<string> {
  return new Set(s.split(/\s+/).filter(Boolean));
}

describe("card + spine", () => {
  it("the card is a clipped, relative floating B+ surface", () => {
    const c = classSet(DETAIL_CARD);
    expect(c.has("relative")).toBe(true);
    expect(c.has("overflow-hidden")).toBe(true);
    expect(c.has("rounded-2xl")).toBe(true);
    expect(c.has("bg-[color:var(--color-b-card)]")).toBe(true);
    expect(c.has("shadow-b-card")).toBe(true);
  });

  it("navy survives only as a thin 3px spine, never a band/fill", () => {
    const c = classSet(DETAIL_SPINE);
    expect(c.has("bg-navy")).toBe(true);
    expect(c.has("w-[3px]")).toBe(true);
    expect(c.has("left-0")).toBe(true);
  });
});

describe("field labels (D2)", () => {
  it("are sentence-case — never uppercase (the indent-bug fix)", () => {
    expect(FIELD_LABEL).not.toContain("uppercase");
    expect(FIELD_LABEL).not.toMatch(/tracking-/);
  });

  it("section labels ARE the one allowed uppercase eyebrow", () => {
    expect(SECTION_LABEL).toContain("uppercase");
    expect(SECTION_LABEL).toContain("font-b-mono");
  });
});

describe("field row geometry (two-column fill)", () => {
  it("is a fixed-label / fluid-value grid with a hairline rule", () => {
    const c = classSet(FIELD_ROW);
    expect(c.has("grid")).toBe(true);
    expect(c.has("grid-cols-[140px_1fr]")).toBe(true);
    expect(c.has("border-b")).toBe(true);
    expect(c.has("last:border-b-0")).toBe(true);
  });
});

describe("fieldValueClass", () => {
  it("mono values use the B+ mono face + tabular figures", () => {
    const c = classSet(fieldValueClass(true));
    expect(c.has("font-b-mono")).toBe(true);
    expect(c.has("tabular-nums")).toBe(true);
  });

  it("non-mono values carry neither", () => {
    const c = classSet(fieldValueClass(false));
    expect(c.has("font-b-mono")).toBe(false);
    expect(c.has("tabular-nums")).toBe(false);
  });

  it("emits no edge/double whitespace", () => {
    for (const out of [fieldValueClass(true), fieldValueClass(false)]) {
      expect(out).toBe(out.trim());
      expect(out).not.toMatch(/\s{2,}/);
    }
  });
});
