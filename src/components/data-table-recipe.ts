// Shared <DataTable> recipe (Phase 9 · Step 3.4 — Gap C).
//
// One dense, floating-card table to replace the 14 hand-rolled <table> blocks
// the Step-1 audit found. Skinned to Direction B+: a warm-white floating card
// with soft navy depth, never-wrap uppercase-eyebrow headers, truncating cells,
// mono tabular figures, and an optional status-LED gutter at the row edge.
//
// Class strings live here (node-testable, no JSX) so data-table-recipe.spec can
// lock the geometry, the truncate invariant, the mono rule, and the LED colours
// against silent re-drift.
//
// Boundary: this is a presentation primitive. Task surfaces keep their own
// rendering (the status-filter lane owns /tasks + /admin/tasks).

import type { StatusTone } from "./status-badge-recipe";

export type DataTableDensity = "comfortable" | "compact";
export type DataTableAlign = "left" | "right";

// The floating B+ card: warm-white surface, soft navy depth, clipped corners,
// body face. The whole table reads in Hanken; cells opt into mono/display.
export const TABLE_CARD =
  "overflow-hidden rounded-2xl bg-[color:var(--color-b-card)] font-b-body shadow-b-card";

// Horizontal-scroll containment so a wide table scrolls within the card instead
// of breaking the page on narrow viewports (the audit's mobile-overflow fix;
// full row-stacking is a later enhancement).
export const TABLE_SCROLL = "w-full overflow-x-auto";

export const TABLE = "w-full border-collapse text-sm";

// Header cell: never wraps; tiny uppercase eyebrow; strong bottom rule.
const TH_BASE =
  "whitespace-nowrap align-middle text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--color-text-tertiary)] border-b border-[color:var(--color-border-strong)]";

// Body cell: truncates past its max-width (with a title tooltip set by the
// component); ink text. The hairline row separator lives on the <tr> (see
// DataTable), so the last row clears it cleanly against the card edge.
const TD_BASE =
  "max-w-[230px] overflow-hidden text-ellipsis whitespace-nowrap align-middle text-[color:var(--color-ink)]";

const TH_DENSITY: Record<DataTableDensity, string> = {
  comfortable: "px-4 py-3",
  compact: "px-3.5 py-2.5",
};

const TD_DENSITY: Record<DataTableDensity, string> = {
  comfortable: "h-[54px] px-4",
  compact: "h-[38px] px-3.5",
};

const ALIGN: Record<DataTableAlign, string> = {
  left: "text-left",
  right: "text-right",
};

export function thClass(
  density: DataTableDensity,
  align: DataTableAlign = "left",
  className = "",
): string {
  return [TH_BASE, TH_DENSITY[density], ALIGN[align], className].filter(Boolean).join(" ");
}

export function tdClass(
  density: DataTableDensity,
  align: DataTableAlign = "left",
  mono = false,
  className = "",
): string {
  return [TD_BASE, TD_DENSITY[density], ALIGN[align], mono ? "font-b-mono tabular-nums" : "", className]
    .filter(Boolean)
    .join(" ");
}

// The 4px status-LED gutter (C borrow): a solid colour rail at the row edge,
// an indicator light per row. Header rail keeps the strong bottom rule so the
// header underline runs unbroken across the gutter.
export function gutterThClass(): string {
  return "w-1 p-0 border-b border-[color:var(--color-border-strong)]";
}

// Static per-tone classes — NOT a dynamic `bg-[…${tone}…]` template. Tailwind
// scans source for literal class names at build time; an interpolated class
// emits an unparseable rule (the `$` breaks CSS). Mirror the TONE record in
// status-badge-recipe.ts so every full class name exists literally in source.
const LED: Record<StatusTone, string> = {
  active: "bg-[color:var(--color-led-active)]",
  paused: "bg-[color:var(--color-led-paused)]",
  risk: "bg-[color:var(--color-led-risk)]",
  ended: "bg-[color:var(--color-led-ended)]",
  new: "bg-[color:var(--color-led-new)]",
};

export function gutterTdClass(tone: StatusTone): string {
  return `w-1 p-0 ${LED[tone]}`;
}

// Sticky-right column (opt-in via DataTableColumn.stickyRight). The admin list
// tables carry a wide actions column (Materialize / Reset password + Disable)
// and overflow the shared content width on desktop, so the action scrolls off
// the card's right edge and is no longer clickable. Pinning that column to the
// right edge of the horizontal-scroll viewport keeps the action fully visible
// while the remaining columns scroll beneath it (the audit's desktop fix; the
// rest of the row still scrolls within the card on narrow viewports).
//
// Opaque card-coloured fill occludes the cells scrolling underneath; STICKY_SHADOW
// is applied as an INLINE box-shadow (not a `shadow-[…]` Tailwind class) to dodge
// the v3 arbitrary-shadow parser that flat-carded the whole app when it mis-read a
// composite shadow value (Phase 11 Batch 1). z-index keeps the header pin above
// the body pins.
const STICKY_RIGHT_BASE = "sticky right-0 bg-[color:var(--color-b-card)]";
export const STICKY_RIGHT_TH = `${STICKY_RIGHT_BASE} z-[2]`;
export const STICKY_RIGHT_TD = `${STICKY_RIGHT_BASE} z-[1]`;
export const STICKY_SHADOW = "-8px 0 8px -8px rgba(37, 45, 96, 0.15)";
