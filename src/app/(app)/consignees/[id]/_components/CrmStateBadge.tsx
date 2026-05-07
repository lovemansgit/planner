// Day 17 / Session A — shared CRM state badge component.
//
// Server-rendered (no interactivity); consumed by the consignees list
// (table cell), the detail page header card, and the History tab
// (per-row from/to badge). State-semantic colors per brief v1.6
// §3.3.11; tokens routed through Tailwind class utilities so the
// v1.6 hex canon (`#252d60` navy, `#3e7c4b` green) is the single
// source of truth.
//
// Design notes:
// - Hairline borders (1px) at rest; matches editorial chrome
//   conventions established in PR #168 (logo lockup + UserMenu).
// - Sentence case label per brief; never title-case except eyebrow
//   labels (this badge is not an eyebrow).
// - `text-xs uppercase tracking-[0.1em]` — established badge typography
//   from /tasks status pills (status.ts:21-26).
// - Sized for inline use: `inline-flex` + small padding; works in
//   both table cells and prose contexts.

import type { ConsigneeCrmState } from "@/modules/consignees";

interface CrmStateBadgeProps {
  readonly state: ConsigneeCrmState;
  /** Optional size variant; "lg" used on header card, default elsewhere. */
  readonly size?: "default" | "lg";
}

interface StateVisual {
  readonly label: string;
  /** Tailwind classes for text + background tint + border. */
  readonly classes: string;
  /** Optional decoration (strikethrough on CHURNED). */
  readonly decoration?: "line-through";
}

const STATE_VISUALS: Record<ConsigneeCrmState, StateVisual> = {
  ACTIVE: {
    label: "Active",
    // Grass Green go-signal per brief v1.6 §3.3.11.
    classes: "border border-green/40 bg-green/10 text-green",
  },
  ON_HOLD: {
    label: "On hold",
    // Stone 600 muted on Ivory.
    classes: "border border-stone-200 bg-ivory text-stone-600",
  },
  HIGH_RISK: {
    label: "High risk",
    // Bright Red — error/hazard semantics.
    classes: "border border-red/40 bg-red/10 text-red",
  },
  INACTIVE: {
    label: "Inactive",
    // Stone 600 muted, no row tint.
    classes: "border border-stone-200 bg-paper text-stone-600",
  },
  CHURNED: {
    label: "Churned",
    // Stone 600 muted with strikethrough applied via decoration.
    classes: "border border-stone-200 bg-paper text-stone-600",
    decoration: "line-through",
  },
  SUBSCRIPTION_ENDED: {
    label: "Ended",
    // Stone 600 with terminal-state framing.
    classes: "border border-stone-200 bg-paper text-stone-600",
  },
};

export function CrmStateBadge({ state, size = "default" }: CrmStateBadgeProps) {
  const visual = STATE_VISUALS[state];
  const sizeClasses =
    size === "lg"
      ? "px-3 py-1 text-xs"
      : "px-2 py-0.5 text-[11px]";
  return (
    <span
      className={`inline-flex items-center rounded-sm uppercase tracking-[0.1em] font-medium ${sizeClasses} ${visual.classes} ${visual.decoration === "line-through" ? "line-through" : ""}`}
      aria-label={`CRM state: ${visual.label}`}
    >
      {visual.label}
    </span>
  );
}

/** Exposed for tests + the modal's "current state" surface. */
export const CRM_STATE_LABELS: Record<ConsigneeCrmState, string> = Object.freeze({
  ACTIVE: STATE_VISUALS.ACTIVE.label,
  ON_HOLD: STATE_VISUALS.ON_HOLD.label,
  HIGH_RISK: STATE_VISUALS.HIGH_RISK.label,
  INACTIVE: STATE_VISUALS.INACTIVE.label,
  CHURNED: STATE_VISUALS.CHURNED.label,
  SUBSCRIPTION_ENDED: STATE_VISUALS.SUBSCRIPTION_ENDED.label,
});
