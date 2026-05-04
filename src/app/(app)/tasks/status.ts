// Day 11 / P5 — task list view: status filter + display contract.
//
// The internal task state machine has 7 values (TaskInternalStatus from
// supabase/migrations/0006_task.sql). The operator UI surfaces all 7 as
// filterable + visually distinct pills, with copy that's friendlier than
// the SCREAMING_SNAKE wire vocabulary.
//
// Filter status is URL state (?status=…) so the operator can share /
// bookmark a specific filtered view; selection state for label
// printing is React state at the client-component layer (see ./client).

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

export const PAGE_SIZE = 50;
