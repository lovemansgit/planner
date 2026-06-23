import { describe, expect, it } from "vitest";

import {
  FORM_LABEL,
  FORM_OPTIONAL,
  inputClass,
  selectClass,
  textareaClass,
} from "../form-field-recipe";

// Phase 9 · Step 3.6 — the shared form-field recipe (Gap G core).
// Phase 10 · Batch B4 — + inputClass/textareaClass (native <input>/<textarea>
// share the Select surface).
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

describe("inputClass", () => {
  it("shares the Select surface (warm-white card + green focus ring)", () => {
    const c = classSet(inputClass());
    expect(c.has("bg-[color:var(--color-b-card)]")).toBe(true);
    expect(c.has("rounded-[10px]")).toBe(true);
    expect(c.has("focus-visible:ring-[color:var(--color-b-focus-ring)]")).toBe(true);
  });

  it("is a text input — symmetric padding, no chevron gutter", () => {
    const c = classSet(inputClass());
    expect(c.has("px-3.5")).toBe(true);
    expect(c.has("pr-9")).toBe(false);
    expect(c.has("appearance-none")).toBe(false);
  });

  it("valid uses the strong border; invalid switches to red", () => {
    expect(inputClass(false)).toContain("border-[color:var(--color-border-strong)]");
    expect(inputClass(true)).toContain("border-red");
    expect(inputClass(true)).not.toContain("border-[color:var(--color-border-strong)]");
  });

  it("appends caller treatment with no edge/double whitespace", () => {
    const out = inputClass(false, "mt-2");
    expect(out).toContain("mt-2");
    expect(out).toBe(out.trim());
    expect(out).not.toMatch(/\s{2,}/);
  });
});

describe("textareaClass", () => {
  it("shares the surface but grows — min height, no fixed h-10", () => {
    const c = classSet(textareaClass());
    expect(c.has("bg-[color:var(--color-b-card)]")).toBe(true);
    expect(c.has("focus-visible:ring-[color:var(--color-b-focus-ring)]")).toBe(true);
    expect(c.has("h-10")).toBe(false);
    expect([...c].some((x) => x.startsWith("min-h-"))).toBe(true);
  });

  it("invalid switches to red", () => {
    expect(textareaClass(true)).toContain("border-red");
  });
});
