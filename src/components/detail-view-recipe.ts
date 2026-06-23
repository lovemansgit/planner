// Shared detail-view recipe (Phase 9 · Step 3.5 — Gap D).
//
// One detail system for admin AND merchant surfaces, replacing the two
// divergent hand-rolled treatments (admin uppercase single-column vs merchant
// sentence-case two-column). Skinned to Direction B+: a floating warm-white
// card whose only navy is a 3px structural spine (never a band), a two-column
// fill (D3, via DetailGrid), and a single FieldRow with sentence-case labels.
//
// Class strings live here (node-testable, no JSX) so detail-view-recipe.spec
// can lock the navy-as-spine rule, the D2 sentence-case labels (which kills the
// recurring "Auth method" indent divergence), the mono-figure rule, and the
// row geometry against silent re-drift.

// The floating B+ card (relative, so the spine can absolutely-position to it).
export const DETAIL_CARD =
  "relative overflow-hidden rounded-2xl bg-[color:var(--color-b-card)] font-b-body shadow-b-card";

// The navy structural spine — the B+ resolution of Terminal's heavy navy band.
export const DETAIL_SPINE = "pointer-events-none absolute inset-y-0 left-0 w-[3px] bg-navy";

// Header: eyebrow + title(+status) on the left, actions on the right.
export const DETAIL_HEADER =
  "flex flex-col gap-4 border-b border-[color:var(--color-border-default)] px-7 py-6 sm:flex-row sm:items-start sm:justify-between";
export const DETAIL_EYEBROW =
  "font-b-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]";
// Title + status sit on one wrapping flex row; the title itself is a real <h1>.
export const DETAIL_TITLE_ROW = "mt-1.5 flex flex-wrap items-center gap-3";
export const DETAIL_TITLE = "font-b-display text-2xl font-bold tracking-[-0.01em] text-navy";
export const DETAIL_ACTIONS = "flex flex-shrink-0 flex-wrap gap-2.5";

// Body: the two-column DetailGrid (D3) lives inside this padded region.
export const DETAIL_BODY = "px-7 py-6";

// Section eyebrow — the ONE place uppercase is allowed (D2: tiny mono eyebrow).
export const SECTION_LABEL =
  "mb-2 font-b-mono text-[10.5px] uppercase tracking-[0.12em] text-[color:var(--color-text-tertiary)]";

// FieldRow: a fixed-label / fluid-value grid with a hairline rule.
export const FIELD_ROW =
  "grid grid-cols-[140px_1fr] gap-4 border-b border-[color:var(--color-border-default)] py-2.5 last:border-b-0";
// Label is SENTENCE-CASE (D2) — never uppercase. This is the indent-bug fix:
// every value renders through the same row, so labels can't drift.
export const FIELD_LABEL = "text-[13.5px] text-[color:var(--color-text-secondary)]";
const FIELD_VALUE = "text-sm font-medium text-[color:var(--color-ink)]";
export const FIELD_EMPTY = "text-sm text-[color:var(--color-text-tertiary)]";

/** Value classes; mono figures use the B+ mono tabular face. */
export function fieldValueClass(mono: boolean): string {
  return [FIELD_VALUE, mono ? "font-b-mono tabular-nums" : ""].filter(Boolean).join(" ");
}
