import { describe, expect, it } from "vitest";

import { buttonClass } from "../button-recipe";

// The shared prominent-action <Button> (audit finding 2 — button-recipe
// drift). It captures the four real recipe combos used on the failed-pushes
// DLQ admin surface, so the recipe lives in one node-tested place instead of
// being re-typed per button. These tests LOCK each combo as an exact class
// set against the bytes that existed before extraction.

function classSet(s: string): Set<string> {
  return new Set(s.split(/\s+/).filter(Boolean));
}

const INVARIANT = ["border", "text-xs", "font-medium", "uppercase", "tracking-[0.15em]", "disabled:opacity-40"];
const OUTLINE = [
  "bg-[color:var(--color-surface-primary)]",
  "text-navy",
  "transition-colors",
  "hover:bg-[color:var(--color-surface-secondary)]",
];

describe("buttonClass", () => {
  it("outline / md / strong reproduces the 'Resolve selected' recipe exactly", () => {
    const expected = new Set([
      ...INVARIANT,
      ...OUTLINE,
      "border-[color:var(--color-border-strong)]",
      "px-5",
      "py-2",
    ]);
    expect(classSet(buttonClass("outline", "md", "strong"))).toEqual(expected);
  });

  it("outline / sm / strong reproduces the per-row 'Retry' recipe exactly", () => {
    const expected = new Set([
      ...INVARIANT,
      ...OUTLINE,
      "border-[color:var(--color-border-strong)]",
      "px-3",
      "py-1.5",
    ]);
    expect(classSet(buttonClass("outline", "sm", "strong"))).toEqual(expected);
  });

  it("outline / md / default reproduces the modal 'Cancel' recipe exactly", () => {
    const expected = new Set([
      ...INVARIANT,
      ...OUTLINE,
      "border-[color:var(--color-border-default)]",
      "px-5",
      "py-2",
    ]);
    expect(classSet(buttonClass("outline", "md", "default"))).toEqual(expected);
  });

  it("filled / md reproduces the modal 'Resolve' (primary) recipe exactly", () => {
    const expected = new Set([
      ...INVARIANT,
      "border-[color:var(--color-border-strong)]",
      "bg-navy",
      "text-paper",
      "transition-opacity",
      "hover:opacity-80",
      "px-5",
      "py-2",
    ]);
    expect(classSet(buttonClass("filled", "md"))).toEqual(expected);
  });

  it("filled ignores tone (border is always strong)", () => {
    expect(classSet(buttonClass("filled", "md", "default"))).toEqual(
      classSet(buttonClass("filled", "md", "strong")),
    );
  });

  it("defaults to outline / md / strong", () => {
    expect(classSet(buttonClass())).toEqual(classSet(buttonClass("outline", "md", "strong")));
  });

  it("appends caller classes and emits no stray whitespace", () => {
    const out = buttonClass("outline", "md", "strong", "w-full");
    expect(classSet(out).has("w-full")).toBe(true);
    expect(out).toBe(out.trim());
    expect(out).not.toMatch(/\s{2,}/);
  });
});
