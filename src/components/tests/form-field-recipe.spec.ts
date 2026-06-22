import { describe, expect, it } from "vitest";

import { FORM_LABEL, FORM_OPTIONAL, selectClass } from "../form-field-recipe";

// Phase 9 · Step 3.6 — the shared form-field recipe (Gap G core).
//
// The <Field> wrapper + the styled <Select> that retires the 13 native selects.
// These lock the sentence-case label (D2), the eyebrow "Optional" tag, and the
// Select's valid/invalid chrome (including the green focus ring).

function classSet(s: string): Set<string> {
  return new Set(s.split(/\s+/).filter(Boolean));
}

describe("form labels (D2)", () => {
  it("the field label is sentence-case — never uppercase", () => {
    expect(FORM_LABEL).not.toContain("uppercase");
  });

  it("the 'Optional' tag is the one allowed tiny uppercase eyebrow", () => {
    expect(FORM_OPTIONAL).toContain("uppercase");
    expect(FORM_OPTIONAL).toContain("font-b-mono");
  });
});

describe("selectClass", () => {
  it("is a chromeless native select with a green focus ring", () => {
    const c = classSet(selectClass());
    expect(c.has("appearance-none")).toBe(true);
    expect(c.has("focus-visible:ring-[color:var(--color-b-focus-ring)]")).toBe(true);
    expect(c.has("bg-[color:var(--color-b-card)]")).toBe(true);
  });

  it("valid state uses the strong border; invalid switches to red", () => {
    expect(selectClass(false)).toContain("border-[color:var(--color-border-strong)]");
    expect(selectClass(true)).toContain("border-red");
    expect(selectClass(true)).not.toContain("border-[color:var(--color-border-strong)]");
  });

  it("appends caller treatment with no edge/double whitespace", () => {
    const out = selectClass(false, "w-40");
    expect(out).toContain("w-40");
    expect(out).toBe(out.trim());
    expect(out).not.toMatch(/\s{2,}/);
  });
});
