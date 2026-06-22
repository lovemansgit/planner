// Shared MetricCard recipe (Phase 9 · Step 3.6 — Gap F).
//
// The dashboard metric unit — distinct from the list-count HeroCount (Gap F
// keeps both, un-conflated). Skinned to B+: a floating warm-white card with a
// MONO tabular value (the C-borrow: counts are figures), an uppercase mono
// eyebrow label, and an optional sublabel. Two tones: `default`, and `alert`
// for the "Failed / at-risk" card. Class strings here (node-testable) so
// metric-card-recipe.spec locks the tones, the mono value, and the grid.

export type MetricTone = "default" | "alert";

interface MetricToneClasses {
  readonly card: string;
  readonly value: string;
}

// Static per-tone classes (no dynamic interpolation — Tailwind needs literals).
// The alert tint reuses the working `border-red/30 bg-red/[0.04]` opacity
// utilities (mapped via the -rgb channels in tailwind.config).
const TONE: Record<MetricTone, MetricToneClasses> = {
  default: { card: "border-[color:var(--color-border-default)] bg-[color:var(--color-b-card)]", value: "text-navy" },
  alert: { card: "border-red/30 bg-red/[0.04]", value: "text-red" },
};

export function metricToneClass(tone: MetricTone = "default"): MetricToneClasses {
  return TONE[tone];
}

export const METRIC_CARD = "flex flex-col gap-1.5 rounded-xl border px-5 py-4";
export const METRIC_LABEL =
  "font-b-mono text-[10.5px] uppercase tracking-[0.12em] text-[color:var(--color-text-tertiary)]";
export const METRIC_VALUE = "font-b-mono text-[28px] font-medium tabular-nums leading-none";
export const METRIC_SUBLABEL = "text-xs text-[color:var(--color-text-secondary)]";

// MetricGrid: the dashboard strip — 2 up on mobile, 3 on tablet, 5 on desktop.
export const METRIC_GRID = "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5";
