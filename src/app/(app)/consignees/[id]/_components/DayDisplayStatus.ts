// Day-20 §3.3.3 — calendar render-time DayDisplayStatus projection.
//
// D56 Phase 8 / Lane 4 (brief v1.31 §3.1.10 + §3.3.11) — the calendar stops
// FOLDING and MISLABELING delivery states. Before: `projectDayDisplayStatus`
// collapsed the coarse 7 internal statuses down to ~6 display states and
// mislabeled `IN_TRANSIT → "Out for delivery"` (wrong — in-transit and
// out-for-delivery are two distinct statuses) and `ASSIGNED | CREATED |
// ON_HOLD → "Scheduled"` (lost three states). Now each task renders the FINE
// SuiteFleet courier state distinctly via Lane 3's shared `resolveCourierDisplay`
// (the single source of truth used by /tasks + every other surface): it reads
// `task.courier_status` and falls back to the coarse `internal_status` map when
// NULL (Planner-only states + pre-backfill rows). The label/colour/icon
// therefore always agree across surfaces.
//
// The calendar keeps three render treatments that are NOT courier states —
// subscription-exception overlays (SKIPPED, APPENDED) and the muted
// CANCELED cell — so the projection is a discriminated union: an `exception`
// overlay (drawn from `DAY_DISPLAY_VISUALS` below) or a `courier` render
// (drawn from Lane 3's `COURIER_STATUS_DISPLAY` via `resolveCourierDisplay`).
//
// Pure helper — no side effects, no I/O. Exported for unit-test coverage via
// the page-test convention.

import {
  resolveCourierDisplay,
  type CourierStatusDisplay,
} from "@/app/(app)/tasks/status";
import type { SubscriptionException } from "@/modules/subscription-exceptions";
import type { Task, TaskStatusFilter } from "@/modules/tasks/types";

/**
 * Calendar-only display states that are NOT SuiteFleet courier states:
 * the two subscription-exception overlays + the muted CANCELED treatment.
 * Every courier state renders via `resolveCourierDisplay` instead.
 */
export type DayExceptionStatus = "SKIPPED" | "APPENDED" | "CANCELED";

/**
 * Discriminated projection result:
 *  - `exception` → a calendar overlay (SKIPPED/APPENDED/CANCELED), rendered
 *    from `DAY_DISPLAY_VISUALS`.
 *  - `courier`   → the fine courier render (label + family pill + icon),
 *    rendered from Lane 3's `COURIER_STATUS_DISPLAY` via `resolveCourierDisplay`.
 */
export type DayDisplayProjection =
  | { readonly kind: "exception"; readonly status: DayExceptionStatus }
  | { readonly kind: "courier"; readonly display: CourierStatusDisplay };

const EXCEPTION_SKIPPED: DayDisplayProjection = { kind: "exception", status: "SKIPPED" };
const EXCEPTION_APPENDED: DayDisplayProjection = { kind: "exception", status: "APPENDED" };
const EXCEPTION_CANCELED: DayDisplayProjection = { kind: "exception", status: "CANCELED" };

/**
 * Project a single day-cell's display from (task | null) + matching
 * subscription exceptions that fall on `date`.
 *
 * Precedence (UNCHANGED from Day-20 — only the task fall-through now renders
 * the fine courier state instead of the folded/mislabeled coarse map):
 *   1. No task + skip exception on `date` → SKIPPED overlay
 *   2. No task + no relevant exception     → null (empty cell, — placeholder)
 *   3. Task + append-without-skip exception on `date` → APPENDED overlay
 *   4. Task CANCELED → CANCELED overlay (muted+strikethrough, not in legend)
 *   5. Task-level SKIPPED row → SKIPPED overlay (Day-28 production fix)
 *   6. Otherwise → the fine courier render:
 *        IN_TRANSIT → "In transit"; OUT_FOR_DELIVERY → "Out for delivery"
 *        (two distinct statuses); ASSIGNED → "Driver assigned"; CREATED-coarse
 *        → "Created"; ON_HOLD-coarse → "On hold"; etc. — never folded.
 */
export function projectDayDisplayStatus(
  task: Task | null,
  exceptions: readonly SubscriptionException[],
  date: string,
): DayDisplayProjection | null {
  const skipException = exceptions.find(
    (e) => e.type === "skip" && e.startDate === date,
  );
  const appendException = exceptions.find(
    (e) => e.type === "append_without_skip" && e.startDate === date,
  );

  if (task === null && skipException !== undefined) return EXCEPTION_SKIPPED;
  if (task === null) return null;
  if (appendException !== undefined) return EXCEPTION_APPENDED;

  // Calendar overlays that predate — and stay distinct from — the fine model.
  if (task.internalStatus === "CANCELED") return EXCEPTION_CANCELED;
  // Task row in internal_status='SKIPPED' (set by addSubscriptionException
  // type='skip' per Day-13 §3.1.1 + migration 0019) — same muted treatment as
  // the no-task + skip-exception path. Closes the Day-28 production TypeError.
  if (task.internalStatus === "SKIPPED") return EXCEPTION_SKIPPED;

  // Every remaining state renders the fine courier status (falling back to the
  // coarse map when courier_status is NULL). Compile-time exhaustiveness over
  // the courier + coarse vocabularies lives in Lane 3's `COURIER_STATUS_DISPLAY`
  // (Record<CourierStatus>) + `COARSE_STATUS_DISPLAY` (Record<TaskInternalStatus>)
  // — a new status value is a compile error there, not a render-time TypeError.
  return {
    kind: "courier",
    display: resolveCourierDisplay(task.courierStatus, task.internalStatus),
  };
}

export interface DayDisplayVisual {
  readonly label: string;
  readonly classes: string;
  readonly inLegend: boolean;
}

/**
 * Visual map for the calendar-only OVERLAY states (SKIPPED / APPENDED /
 * CANCELED). Fine courier states render from Lane 3's `COURIER_STATUS_DISPLAY`
 * (single source of truth) — they are deliberately NOT duplicated here, so the
 * calendar can never drift from the /tasks pill colours/labels. The
 * `Record<DayExceptionStatus, …>` keeps the exhaustiveness guard for the
 * overlay union at compile time.
 *
 * `inLegend: false` for CANCELED — renders muted+strikethrough on the day
 * cell but is excluded from the legend per the Day-20 ruling.
 */
export const DAY_DISPLAY_VISUALS: Record<DayExceptionStatus, DayDisplayVisual> = {
  SKIPPED: {
    label: "Skipped",
    classes:
      "bg-[color:var(--color-text-secondary)]/15 text-[color:var(--color-text-secondary)] line-through",
    inLegend: true,
  },
  APPENDED: {
    label: "Appended",
    classes: "border border-green/30 bg-green/10 text-green",
    inLegend: true,
  },
  CANCELED: {
    label: "Canceled",
    classes:
      "bg-[color:var(--color-text-tertiary)]/20 text-[color:var(--color-text-tertiary)] line-through opacity-70",
    inLegend: false,
  },
};

/**
 * Filter calendar tasks to a single status (the calendar's `?status=` control),
 * aligned to what each row RENDERS. This is the client twin of the server-side
 * `buildCourierStatusFilter` (src/modules/tasks/repository.ts) — keep the two in
 * lock-step: a row renders `resolveCourierDisplay(courier_status,
 * internal_status)` (the FINE courier state when present, else the COARSE
 * internal_status fallback), and the filter matches on exactly that, so "what
 * you can filter" == "what you see".
 *
 * D57 OQ-5 (Love's Day-57 ruling, recorded in
 * memory/decision_d56_phase8_status_distinct_render.md — supersedes the earlier
 * "calendar forward-only" rule): a NULL-courier row (Planner-only state /
 * pre-backfill) now matches the filter for the coarse status it displays —
 * e.g. a NULL-courier IN_TRANSIT / CREATED / SKIPPED row is matched by that
 * filter, no longer All-only. Fine-only values (OUT_FOR_DELIVERY, PICKED_UP, …)
 * never appear in the 8-value internal_status domain, so the coarse fallback is
 * inert for them — no false positives.
 *
 * ON_HOLD is the single exception (D57 Item C, mirroring the server): a
 * recognised filter value whose predicate matches nothing —
 * `courier_status === 'ON_HOLD'` is never true (ON_HOLD is not a fine courier
 * state) and its coarse fallback is suppressed, so legacy ON_HOLD rows stay
 * All-only and render label-neutral.
 *
 * A `null` filter is the "All" view and returns the list unchanged. Pure —
 * render-layer narrowing of an already-fetched range.
 */
export function filterTasksByCourierStatus(
  tasks: readonly Task[],
  status: TaskStatusFilter | null,
): readonly Task[] {
  if (status === null) return tasks;
  // ON_HOLD: the server filters `courier_status = 'ON_HOLD'`, which the 0035
  // CHECK constraint guarantees is always empty (ON_HOLD is not a fine courier
  // state). The client `courierStatus` type (CourierStatus) excludes ON_HOLD
  // for the same reason, so the faithful, type-safe mirror is to match nothing.
  if (status === "ON_HOLD") return [];
  return tasks.filter(
    (t) =>
      t.courierStatus === status ||
      (t.courierStatus === null && t.internalStatus === status),
  );
}

export interface DayCellVisual {
  readonly label: string;
  readonly classes: string;
}

/**
 * Normalise a projection to the `{ label, classes }` a day cell (and the
 * DayActionPopover status pill) render. Overlay states use
 * `DAY_DISPLAY_VISUALS`; courier states use the fine `pillClass` + label from
 * `resolveCourierDisplay`. The within-family distinction on the dense month
 * cells is carried by the label text (e.g. "Picked up" vs "Out for delivery"
 * share the amber family) — the per-state icon is showcased in the legend +
 * the roomier day-view rows.
 */
export function dayCellVisual(projection: DayDisplayProjection): DayCellVisual {
  if (projection.kind === "exception") {
    const visual = DAY_DISPLAY_VISUALS[projection.status];
    return { label: visual.label, classes: visual.classes };
  }
  return { label: projection.display.label, classes: projection.display.pillClass };
}
