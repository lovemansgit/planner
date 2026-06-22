import { describe, expect, it } from "vitest";

import { bButtonClass, buttonClass, type BButtonSize, type BButtonVariant } from "../button-recipe";

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

// Direction B ("Dispatch") recipe — Phase 9 Step 3.2. Locks every variant×size
// and the cross-cutting invariants that make the audit's button drift impossible
// (one primary colour, the never-wrap rule, exactly one utility per property).
const B_INVARIANT = [
  "inline-flex",
  "items-center",
  "justify-center",
  "gap-2",
  "whitespace-nowrap",
  "font-b-body",
  "font-semibold",
  "border",
  "border-transparent",
  "transition-[color,background-color,border-color,box-shadow,transform]",
  "duration-150",
  "ease-out",
  "active:translate-y-px",
  "focus-visible:outline",
  "focus-visible:outline-2",
  "focus-visible:outline-offset-2",
  "focus-visible:outline-[color:var(--color-green)]",
  "disabled:opacity-45",
  "disabled:pointer-events-none",
  "disabled:shadow-none",
  "aria-disabled:opacity-45",
  "aria-disabled:pointer-events-none",
  "aria-disabled:shadow-none",
];

const B_VARIANTS: readonly BButtonVariant[] = ["primary", "secondary", "ghost", "danger"];
const B_SIZES: readonly BButtonSize[] = ["sm", "md", "lg"];

describe("bButtonClass", () => {
  it("primary / md reproduces the Direction-B primary recipe exactly", () => {
    const expected = new Set([
      ...B_INVARIANT,
      // shape
      "h-10",
      "rounded-[10px]",
      "text-sm",
      // metrics (solid)
      "px-[18px]",
      "min-w-[88px]",
      // variant — the one that lifts
      "bg-green",
      "text-paper",
      "shadow-[var(--shadow-b-rest)]",
      "hover:bg-[color:var(--color-green-hover)]",
      "hover:shadow-[var(--shadow-b-lift)]",
    ]);
    expect(classSet(bButtonClass("primary", "md"))).toEqual(expected);
  });

  it("secondary stays flat (no resting/lift shadow)", () => {
    const cls = classSet(bButtonClass("secondary", "md"));
    expect(cls.has("bg-[color:var(--color-b-card)]")).toBe(true);
    expect(cls.has("text-navy")).toBe(true);
    expect(cls.has("border-[color:var(--color-border-strong)]")).toBe(true);
    expect(cls.has("hover:border-navy")).toBe(true);
    expect([...cls].some((c) => c.includes("shadow-[var(--shadow-b"))).toBe(false);
  });

  it("ghost uses tighter padding and no min-width", () => {
    const cls = classSet(bButtonClass("ghost", "md"));
    expect(cls.has("px-3")).toBe(true);
    expect([...cls].some((c) => c.startsWith("min-w-"))).toBe(false);
    expect(cls.has("bg-transparent")).toBe(true);
    expect(cls.has("hover:text-navy")).toBe(true);
  });

  it("danger uses the brand red, flat, inverting on hover", () => {
    const cls = classSet(bButtonClass("danger", "md"));
    expect(cls.has("text-red")).toBe(true);
    expect(cls.has("border-[color:rgb(var(--color-red-rgb)/0.34)]")).toBe(true);
    expect(cls.has("hover:bg-red")).toBe(true);
    expect(cls.has("hover:text-paper")).toBe(true);
    expect([...cls].some((c) => c.includes("shadow-[var(--shadow-b"))).toBe(false);
  });

  it("size ladder sets exactly one height per size", () => {
    expect(classSet(bButtonClass("primary", "sm")).has("h-8")).toBe(true);
    expect(classSet(bButtonClass("primary", "md")).has("h-10")).toBe(true);
    expect(classSet(bButtonClass("primary", "lg")).has("h-[46px]")).toBe(true);
  });

  it("defaults to primary / md", () => {
    expect(classSet(bButtonClass())).toEqual(classSet(bButtonClass("primary", "md")));
  });

  it("NEVER wraps — every variant×size carries whitespace-nowrap", () => {
    for (const v of B_VARIANTS) {
      for (const s of B_SIZES) {
        expect(classSet(bButtonClass(v, s)).has("whitespace-nowrap")).toBe(true);
      }
    }
  });

  it("emits exactly one utility per conflicting property (no class cancels another)", () => {
    const prefixes = ["h-", "px-", "rounded-", "text-["];
    for (const v of B_VARIANTS) {
      for (const s of B_SIZES) {
        const classes = bButtonClass(v, s).split(/\s+/).filter(Boolean);
        // exactly one height
        expect(classes.filter((c) => /^h-/.test(c)).length).toBe(1);
        // exactly one base (non-hover/focus) horizontal padding
        expect(classes.filter((c) => /^px-/.test(c)).length).toBe(1);
        // exactly one base radius
        expect(classes.filter((c) => /^rounded-/.test(c)).length).toBe(1);
        // at most one min-width (solid: 1, ghost: 0)
        expect(classes.filter((c) => /^min-w-/.test(c)).length).toBeLessThanOrEqual(1);
        void prefixes;
      }
    }
  });

  it("only primary carries a resting elevation shadow", () => {
    expect(bButtonClass("primary", "md")).toContain("shadow-[var(--shadow-b-rest)]");
    for (const v of ["secondary", "ghost", "danger"] as const) {
      expect(bButtonClass(v, "md")).not.toContain("shadow-[var(--shadow-b-rest)]");
    }
  });

  it("appends caller classes and emits no stray whitespace", () => {
    const out = bButtonClass("primary", "md", "w-full");
    expect(classSet(out).has("w-full")).toBe(true);
    expect(out).toBe(out.trim());
    expect(out).not.toMatch(/\s{2,}/);
  });
});
