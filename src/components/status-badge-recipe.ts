// Shared <StatusBadge> recipe (Phase 9 · Step 3.3 — Gap B).
//
// One status pill family for the CRM, subscription, and push domains. The
// component owns the status→{label, tone} mapping, so callers never pick a
// colour or write a status label again — retiring the dot+text, strikethrough,
// bordered, and bare-text variants the Step-1 audit flagged.
//
// Skin: Direction B+ (memory/plans/day-58-phase9-direction-b-plus) — a
// soft-filled, dot-less, sentence-case, rounded-full pill. Five tones map to
// the locked StatusBadge palette (#558 Gap B):
//   green = healthy/active · amber = paused/attention · red = failed/at-risk ·
//   stone = ended/neutral · navy = created/new.
//
// Boundary: task surfaces (/tasks, /admin/tasks) are NOT covered — the
// status-filter lane owns task-status rendering. There is deliberately no
// `task` domain here.
//
// Class strings live here (node-testable, no JSX) so status-badge-recipe.spec
// can lock each tone + every domain mapping against silent re-drift.

export type StatusTone = "active" | "paused" | "risk" | "ended" | "new";
export type StatusDomain = "subscription" | "crm" | "push";
export type StatusBadgeSize = "md" | "lg";

export interface StatusMeta {
  readonly label: string;
  readonly tone: StatusTone;
}

// Sentence-case labels + one tone per status. Unknown values fall through to a
// humanised neutral pill in the component (never a crash).
const SUBSCRIPTION: Record<string, StatusMeta> = {
  active: { label: "Active", tone: "active" },
  paused: { label: "Paused", tone: "paused" },
  ended: { label: "Ended", tone: "ended" },
};

// Mirrors ConsigneeCrmState (src/modules/consignees/types). Sentence-case
// labels match CRM_STATE_LABELS; CHURNED drops its strikethrough per #558.
const CRM: Record<string, StatusMeta> = {
  ACTIVE: { label: "Active", tone: "active" },
  ON_HOLD: { label: "On hold", tone: "paused" },
  HIGH_RISK: { label: "High risk", tone: "risk" },
  INACTIVE: { label: "Inactive", tone: "ended" },
  CHURNED: { label: "Churned", tone: "ended" },
  SUBSCRIPTION_ENDED: { label: "Ended", tone: "ended" },
};

// Push is a binary lifecycle (#558 Gap B): a failed delivery push is either
// still unresolved (needs attention → red) or resolved (handled → stone). The
// failure REASON is a separate humanised field, never a status pill.
const PUSH: Record<string, StatusMeta> = {
  unresolved: { label: "Unresolved", tone: "risk" },
  resolved: { label: "Resolved", tone: "ended" },
};

const MAPS: Record<StatusDomain, Record<string, StatusMeta>> = {
  subscription: SUBSCRIPTION,
  crm: CRM,
  push: PUSH,
};

/** Resolve a (domain, raw status) to its label + tone, or null if unknown. */
export function statusMeta(domain: StatusDomain, status: string): StatusMeta | null {
  return MAPS[domain][status] ?? null;
}

// One soft-filled, dot-less, sentence-case, rounded-full geometry (B+).
const BASE = "inline-flex items-center justify-center rounded-full font-semibold";

const SIZE: Record<StatusBadgeSize, string> = {
  md: "px-2.5 py-0.5 text-xs",
  lg: "px-3 py-1 text-xs",
};

// Tone → soft fill + ink, routed through the Phase 9 status-tone tokens in
// brand-tokens.css (locked #558 Gap B palette). Direct var() references, so no
// Tailwind opacity / -rgb channels are involved.
const TONE: Record<StatusTone, string> = {
  active: "bg-[color:var(--color-status-active-bg)] text-[color:var(--color-status-active-ink)]",
  paused: "bg-[color:var(--color-status-paused-bg)] text-[color:var(--color-status-paused-ink)]",
  risk: "bg-[color:var(--color-status-risk-bg)] text-[color:var(--color-status-risk-ink)]",
  ended: "bg-[color:var(--color-status-ended-bg)] text-[color:var(--color-status-ended-ink)]",
  new: "bg-[color:var(--color-status-new-bg)] text-[color:var(--color-status-new-ink)]",
};

/** Tone-only classes (fill + ink), for callers that own their own geometry. */
export function statusToneClass(tone: StatusTone): string {
  return TONE[tone];
}

/** Compose the full pill classes for a tone + size, appending caller treatment. */
export function statusBadgeClass(
  tone: StatusTone,
  size: StatusBadgeSize = "md",
  className = "",
): string {
  return [BASE, SIZE[size], TONE[tone], className].filter(Boolean).join(" ");
}
