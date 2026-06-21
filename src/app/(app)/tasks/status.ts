// Day 11 / P5 — task list view: status filter + display contract.
//
// The internal task state machine has 8 values (TaskInternalStatus from
// supabase/migrations/0006_task.sql + 0019). `TASK_STATUS_FILTERS` is the
// COARSE display catalogue, still consumed by /admin/tasks (Lane 5) and as
// the NULL-fallback render for rows that have no fine courier_status.
//
// D56 Phase 8 / Lane 3 (brief v1.31 §3.1.10 + §3.3.11) — the operator
// surfaces now render the FINE SuiteFleet courier state distinctly: 14
// values carried by the nullable `tasks.courier_status` column. The fine
// model lives below as `COURIER_STATUS_DISPLAY` (label + family-colour pill
// + icon key), `resolveCourierDisplay` (fine, falling back to coarse when
// NULL), the `COURIER_STATUS_FILTER_OPTIONS` dropdown set, and
// `parseCourierStatusParam`. Render reads fine; business logic keeps reading
// coarse `internal_status` (unchanged). NO new hex — every pill colour is a
// §3.3.11 brand token (tailwind.config.ts / brand-tokens.css).
//
// Filter status is URL state (?status=…) so the operator can share /
// bookmark a specific filtered view; selection state for label
// printing is React state at the client-component layer (see ./client).

import type { CourierStatus } from "@/modules/integration";
import type { TaskInternalStatus } from "@/modules/tasks";

export interface StatusFilterEntry {
  readonly value: TaskInternalStatus;
  readonly label: string;
  /** Tailwind class fragment for the pill background + text. */
  readonly pillClass: string;
}

export const TASK_STATUS_FILTERS: readonly StatusFilterEntry[] = [
  { value: "CREATED", label: "Created", pillClass: "bg-[color:var(--color-text-tertiary)]/20 text-[color:var(--color-text-secondary)]" },
  { value: "ASSIGNED", label: "Assigned", pillClass: "bg-amber/15 text-amber" },
  { value: "IN_TRANSIT", label: "In transit", pillClass: "bg-amber/20 text-amber" },
  { value: "DELIVERED", label: "Delivered", pillClass: "bg-green/15 text-green" },
  { value: "FAILED", label: "Failed", pillClass: "bg-red/15 text-red" },
  { value: "CANCELED", label: "Cancelled", pillClass: "bg-[color:var(--color-text-tertiary)]/20 text-[color:var(--color-text-tertiary)]" },
  { value: "ON_HOLD", label: "On hold", pillClass: "bg-[color:var(--color-text-secondary)]/20 text-[color:var(--color-text-secondary)]" },
] as const;

const VALID_STATUSES: ReadonlySet<string> = new Set(TASK_STATUS_FILTERS.map((s) => s.value));

/**
 * Parse the `?status=` query param. Returns the validated status or
 * undefined for "no filter" (including invalid input — silently drops
 * unknown statuses, matches the no-filter view).
 */
export function parseStatusParam(raw: string | string[] | undefined): TaskInternalStatus | undefined {
  if (typeof raw !== "string") return undefined;
  if (!VALID_STATUSES.has(raw)) return undefined;
  return raw as TaskInternalStatus;
}

// =============================================================================
// D56 Phase 8 / Lane 3 — fine courier_status render contract
//
// Brief v1.31 §3.1.10 (fine model) + §3.3.11 (delivery-status colour families).
// Plan `memory/plans/day-56-phase-8-status-distinct-render.md` §3 (per-state
// label + icon + family-colour table) + §6 item 1.
//
// Every one of the 14 fine states renders DISTINCTLY by the COMBINATION of a
// family colour + an icon + a label (Love's enumeration ruling) — never colour
// alone. Where states share a family colour (the amber transit ramp, the red
// failure family, the stone-600 hold pair) the icon + label disambiguate. NO
// new hex, no palette widening: each colour is a brand token from §3.3.11.
// =============================================================================

/**
 * Status-glyph identifier. Kept as a string key (not a component ref) so this
 * module stays pure data — server-importable (the /tasks page + visible-ids
 * route read the parsers/maps) without pulling icon components into the server
 * graph. `StatusIcon.tsx` owns the single key→SVG binding (incl. variants).
 */
export type StatusIconKey =
  | "package"
  | "van"
  | "truck"
  | "pod"
  | "caution"
  | "pickup"
  | "dc"
  | "hub"
  | "ofd"
  | "return-outline"
  | "return-solid"
  | "reschedule"
  | "retry";

export interface CourierStatusDisplay {
  /** Operator-facing label (friendlier than the SCREAMING_SNAKE wire code). */
  readonly label: string;
  /** Tailwind class fragment for the pill background + text (family colour). */
  readonly pillClass: string;
  /** Glyph key for StatusIcon, or null for an inert no-glyph state (CANCELED). */
  readonly iconKey: StatusIconKey | null;
}

/**
 * The single shared per-state render map consumed by every operator surface
 * (this lane wires /tasks; Lanes 4-5 wire the calendar + the other 8). Order
 * mirrors `COURIER_STATUS_VALUES` (the integration enum + the migration-0035
 * CHECK); the `Record<CourierStatus, …>` type enforces exhaustiveness at
 * compile time.
 *
 * Family colours (§3.3.11): Neutral Stone (ORDERED, CANCELED line-through) ·
 * Info Ocean Blue (ASSIGNED) · Amber ramp (the in-transit journey, deepening
 * Amber-100→300→600→Deep, with OUT_FOR_DELIVERY on the hi-vis CORE Signal
 * Amber `bg-amber` — Love-locked highest-attention) · Success Grass Green
 * (DELIVERED) · Alarm Bright Red (the failure family) · Hold Stone-600 on
 * Ivory (the RESCHEDULED/REATTEMPT pair). The amber ramp uses light tints with
 * the rung hex as the TEXT colour so the navy/amber glyphs stay legible; OFD
 * is the one solid-fill pill, which is what makes it pop as brightest.
 */
export const COURIER_STATUS_DISPLAY: Record<CourierStatus, CourierStatusDisplay> = {
  ORDERED: { label: "Ordered", pillClass: "bg-stone-200/60 text-stone-600", iconKey: "package" },
  ASSIGNED: { label: "Driver assigned", pillClass: "bg-ocean-blue/15 text-ocean-blue", iconKey: "van" },
  PICKED_UP: { label: "Picked up", pillClass: "bg-amber-100 text-amber-deep", iconKey: "pickup" },
  ARRIVED_AT_DC: { label: "Arrived in DC", pillClass: "bg-amber-300 text-amber-deep", iconKey: "dc" },
  IN_TRANSIT: { label: "In transit", pillClass: "bg-amber-600/15 text-amber-600", iconKey: "truck" },
  HUB_TRANSFER: { label: "Hub transfer", pillClass: "bg-amber-deep/15 text-amber-deep", iconKey: "hub" },
  OUT_FOR_DELIVERY: { label: "Out for delivery", pillClass: "bg-amber text-navy", iconKey: "ofd" },
  DELIVERED: { label: "Delivered", pillClass: "bg-green/15 text-green", iconKey: "pod" },
  FAILED: { label: "Delivery failed", pillClass: "bg-red/15 text-red", iconKey: "caution" },
  PROCESS_FOR_RETURN: { label: "Processing return", pillClass: "bg-red/15 text-red", iconKey: "return-outline" },
  RETURNED_TO_SHIPPER: { label: "Returned to shipper", pillClass: "bg-red/15 text-red", iconKey: "return-solid" },
  CANCELED: { label: "Cancelled", pillClass: "bg-stone-200/60 text-stone-600 line-through", iconKey: null },
  RESCHEDULED: { label: "Rescheduled", pillClass: "bg-ivory text-stone-600 border border-stone-200", iconKey: "reschedule" },
  REATTEMPT: { label: "Reattempt scheduled", pillClass: "bg-ivory text-stone-600 border border-stone-200", iconKey: "retry" },
};

/**
 * Coarse NULL-fallback render. A row with `courier_status = NULL` (Planner-only
 * state — SKIPPED, manual cancel — or a pre-backfill row) renders EXACTLY as it
 * did before this lane: this map mirrors `TASK_STATUS_FILTERS` (label + pill)
 * plus the legacy `StatusIcon` glyph per coarse status. SKIPPED is added here
 * for exhaustiveness (it previously fell through to a label-only pill).
 * `resolveCourierDisplay` reaches for this only when the fine field is absent.
 */
const COARSE_STATUS_DISPLAY: Record<TaskInternalStatus, CourierStatusDisplay> = {
  CREATED: {
    label: "Created",
    pillClass: "bg-[color:var(--color-text-tertiary)]/20 text-[color:var(--color-text-secondary)]",
    iconKey: "package",
  },
  ASSIGNED: { label: "Assigned", pillClass: "bg-amber/15 text-amber", iconKey: "van" },
  IN_TRANSIT: { label: "In transit", pillClass: "bg-amber/20 text-amber", iconKey: "truck" },
  DELIVERED: { label: "Delivered", pillClass: "bg-green/15 text-green", iconKey: "pod" },
  FAILED: { label: "Failed", pillClass: "bg-red/15 text-red", iconKey: "caution" },
  CANCELED: {
    label: "Cancelled",
    pillClass: "bg-[color:var(--color-text-tertiary)]/20 text-[color:var(--color-text-tertiary)]",
    iconKey: null,
  },
  ON_HOLD: {
    label: "On hold",
    pillClass: "bg-[color:var(--color-text-secondary)]/20 text-[color:var(--color-text-secondary)]",
    iconKey: null,
  },
  SKIPPED: {
    label: "Skipped",
    pillClass: "bg-[color:var(--color-text-tertiary)]/20 text-[color:var(--color-text-secondary)]",
    iconKey: null,
  },
};

/**
 * Resolve the render entry for a task row: the FINE `courier_status` when
 * present, else the coarse `internal_status` fallback. This is the single
 * helper every render surface (row pill, StatusIcon, Lanes 4-5) calls so the
 * label, colour and glyph always agree.
 */
export function resolveCourierDisplay(
  courierStatus: CourierStatus | null | undefined,
  internalStatus: TaskInternalStatus,
): CourierStatusDisplay {
  if (courierStatus != null) return COURIER_STATUS_DISPLAY[courierStatus];
  return COARSE_STATUS_DISPLAY[internalStatus];
}

export interface CourierStatusFilterOption {
  readonly value: CourierStatus;
  readonly label: string;
}

/**
 * The fine-14 dropdown options (the control adds an "All" / no-filter entry).
 * Derived from `COURIER_STATUS_DISPLAY` so labels never drift; order mirrors
 * the canonical enum.
 */
export const COURIER_STATUS_FILTER_OPTIONS: readonly CourierStatusFilterOption[] = (
  Object.keys(COURIER_STATUS_DISPLAY) as CourierStatus[]
).map((value) => ({ value, label: COURIER_STATUS_DISPLAY[value].label }));

const VALID_COURIER_STATUSES: ReadonlySet<string> = new Set(
  Object.keys(COURIER_STATUS_DISPLAY),
);

/**
 * Parse the `?status=` query param as a FINE courier_status (D56 Lane 3 — Love
 * ruling: ?status= now carries the fine 14-state vocabulary; single filter,
 * single param). Unknown values — including the retired coarse statuses
 * (CREATED, ON_HOLD, SKIPPED) carried by stale bookmarks — silently degrade to
 * "no filter" (the All view) rather than 4xx-ing the operator, mirroring the
 * coarse `parseStatusParam` posture.
 *
 * Kept separate from `parseStatusParam` (which stays coarse) because
 * /admin/tasks still consumes the coarse parser + `listAllTasks` until Lane 5
 * migrates it; repointing the shared parser in-place would break that
 * not-yet-migrated surface.
 */
export function parseCourierStatusParam(
  raw: string | string[] | undefined,
): CourierStatus | undefined {
  if (typeof raw !== "string") return undefined;
  if (!VALID_COURIER_STATUSES.has(raw)) return undefined;
  return raw as CourierStatus;
}

/**
 * Parse the `?page=` query param. Returns a 1-based page number; falls
 * back to 1 for missing / non-numeric / negative input.
 */
export function parsePageParam(raw: string | string[] | undefined): number {
  if (typeof raw !== "string") return 1;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return n;
}

// Day 17 / Session B — page-size dropdown.
//
// Default stays at 50 (pre-Day-17 behaviour); the dropdown widens the
// viewport so an operator running a high-volume morning batch can hold
// the whole tenant in one selection without paging. 500 matches the SF
// label-endpoint cap (probed Day 17 — see commit message + PR notes).
export const PAGE_SIZE_DEFAULT = 50;
export const ALLOWED_PAGE_SIZES = [50, 100, 300, 500] as const;
export type AllowedPageSize = (typeof ALLOWED_PAGE_SIZES)[number];

/** Back-compat alias — existing callers continue to work. */
export const PAGE_SIZE = PAGE_SIZE_DEFAULT;

/**
 * Parse the `?perPage=` query param. Clamps invalid / unknown values
 * to PAGE_SIZE_DEFAULT so that bookmarks with stale query strings
 * degrade to the safe default rather than 4xx-ing the operator.
 */
export function parsePerPageParam(raw: string | string[] | undefined): AllowedPageSize {
  if (typeof raw !== "string") return PAGE_SIZE_DEFAULT;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return PAGE_SIZE_DEFAULT;
  return (ALLOWED_PAGE_SIZES as readonly number[]).includes(n)
    ? (n as AllowedPageSize)
    : PAGE_SIZE_DEFAULT;
}
