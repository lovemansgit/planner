// Task editability — pure status predicates (Day-54 extraction).
//
// Love's Day-54 ruling (brief v1.25): the 18:00 cutoff is the
// order-CREATION deadline only; editability is gated by assignment
// alone. A task is editable iff it is not driver-bound
// (ASSIGNED/IN_TRANSIT — "once ASSIGNED, no edits or cancellations",
// and pickup does not unlock it) and not terminal. Exactly
// CREATED / ON_HOLD / SKIPPED are editable.
//
// Lives in its own module (no db / server imports) so "use client"
// surfaces — the /tasks row actions, the calendar popover — can share
// the SAME predicates the service layer enforces, instead of
// re-deriving the status sets per surface. service.ts re-exports.

import type { TaskInternalStatus } from "./types";

export const DRIVER_BOUND_STATUSES: ReadonlySet<TaskInternalStatus> = new Set([
  "ASSIGNED",
  "IN_TRANSIT",
]);

export const TERMINAL_STATUSES: ReadonlySet<TaskInternalStatus> = new Set([
  "DELIVERED",
  "CANCELED",
  "FAILED",
]);

export function isTaskDriverBound(internalStatus: TaskInternalStatus): boolean {
  return DRIVER_BOUND_STATUSES.has(internalStatus);
}

export function isTaskEditable(internalStatus: TaskInternalStatus): boolean {
  return !DRIVER_BOUND_STATUSES.has(internalStatus) && !TERMINAL_STATUSES.has(internalStatus);
}
