// Day 22 / Phase 1 forms lane — subscription form parser + preview helpers.
//
// Lives in _helpers (not _actions) so unit tests cover the cadence
// preset + preview-count invariants without dragging the "use server"
// chain (which transitively imports @/shared/db). Pattern mirrors
// src/app/(admin)/admin/merchants/_helpers.ts.

import {
  parseSelectedWeekdays,
  weekdaysToIsoOrdinals,
  type Weekday,
} from "@/components/forms/WeekdaySelector";
import { validateTimeWindow } from "@/components/forms/TimeWindowPicker";
import type { CreateSubscriptionInput } from "@/modules/subscriptions";

/**
 * Cadence preset chip wording per OQ-2 ruling — sentence-case three-
 * letter shorthand. The exact strings render in the chip buttons; the
 * `weekdays` array prefills the WeekdaySelector when the chip is
 * picked. "Custom" is the no-prefill state — operators arrive at
 * this when they edit the per-checkbox state away from any preset.
 */
export interface CadencePreset {
  readonly key: "mon-fri" | "mon-wed-fri" | "weekend" | "daily" | "custom";
  readonly label: string;
  readonly weekdays: ReadonlyArray<Weekday>;
}

export const CADENCE_PRESETS: ReadonlyArray<CadencePreset> = [
  { key: "mon-fri", label: "Mon-Fri", weekdays: ["mon", "tue", "wed", "thu", "fri"] },
  { key: "mon-wed-fri", label: "Mon-Wed-Fri", weekdays: ["mon", "wed", "fri"] },
  { key: "weekend", label: "Weekend", weekdays: ["sat", "sun"] },
  { key: "daily", label: "Daily", weekdays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] },
  { key: "custom", label: "Custom", weekdays: [] },
];

/**
 * Detect which preset (if any) matches the current weekday selection.
 * Used to re-highlight a preset chip when the WeekdaySelector state
 * matches it. Returns "custom" when no preset matches the selection.
 */
export function detectPreset(selected: ReadonlySet<Weekday>): CadencePreset["key"] {
  for (const preset of CADENCE_PRESETS) {
    if (preset.key === "custom") continue;
    if (preset.weekdays.length !== selected.size) continue;
    if (preset.weekdays.every((w) => selected.has(w))) return preset.key;
  }
  return "custom";
}

function isoDate(raw: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

/**
 * Count subscription-mode tasks that would generate over a window.
 * Pure helper for the preview component's hero numeral.
 *
 *   - startDate: ISO YYYY-MM-DD (inclusive)
 *   - endDate: ISO YYYY-MM-DD (inclusive) OR null (use horizonDays)
 *   - isoWeekdays: Set of 1..7 (Mon=1)
 *
 * When endDate is null we project a horizon (default 31 days = the
 * cron-decoupled materialization horizon per Day-14 §3) so operators
 * see a representative count rather than 0.
 */
export function countSubscriptionTasks(
  startDate: string,
  endDate: string | null,
  isoWeekdays: ReadonlySet<number>,
  horizonDays = 31,
): number {
  const start = new Date(startDate + "T00:00:00Z");
  const end =
    endDate !== null
      ? new Date(endDate + "T00:00:00Z")
      : new Date(start.getTime() + (horizonDays - 1) * 86400000);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  if (end < start) return 0;
  let count = 0;
  for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
    const dow = new Date(t).getUTCDay(); // JS Sun=0 .. Sat=6
    const iso = dow === 0 ? 7 : dow; // ISO Mon=1 .. Sun=7
    if (isoWeekdays.has(iso)) count++;
  }
  return count;
}

/**
 * Count single-task tasks for the OQ-3 single-task-mode date-range
 * path. No weekday filter — every day in the inclusive range
 * generates one ad-hoc task. Single-day shape collapses to count=1.
 */
export function countSingleTaskRange(
  startDate: string,
  endDate: string | null,
): number {
  if (endDate === null) return 1;
  const start = new Date(startDate + "T00:00:00Z");
  const end = new Date(endDate + "T00:00:00Z");
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  if (end < start) return 0;
  return Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
}

/**
 * Render-side helper for the date-range descriptor. Returns
 * "1 May – 31 May" or "1 May" for a single date. Pure; safe for
 * server / client usage.
 */
export function formatDateRange(
  startDate: string,
  endDate: string | null,
): string {
  const start = new Date(startDate + "T00:00:00Z");
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
  if (endDate === null || endDate === startDate) return fmt(start);
  const end = new Date(endDate + "T00:00:00Z");
  if (Number.isNaN(end.getTime())) return fmt(start);
  return `${fmt(start)} – ${fmt(end)}`;
}

// ---------------------------------------------------------------------------
// Subscription-mode submit parsing
// ---------------------------------------------------------------------------

export type ParseSubscriptionFormResult =
  | { readonly ok: true; readonly value: CreateSubscriptionInput }
  | {
      readonly ok: false;
      readonly fieldErrors: Readonly<Record<string, string>>;
    };

export function parseSubscriptionForm(
  formData: FormData,
): ParseSubscriptionFormResult {
  const fieldErrors: Record<string, string> = {};
  const trimmed = (key: string): string => {
    const v = formData.get(key);
    return typeof v === "string" ? v.trim() : "";
  };

  const consigneeId = trimmed("consignee_id");
  if (consigneeId.length === 0) {
    fieldErrors.consignee_id = "Pick a consignee.";
  }

  const startDateRaw = trimmed("start_date");
  const startDate = isoDate(startDateRaw);
  if (startDate === null) {
    fieldErrors.start_date = "Start date is required (YYYY-MM-DD).";
  }

  const endDateRaw = trimmed("end_date");
  const endDate = endDateRaw.length === 0 ? null : isoDate(endDateRaw);
  if (endDate === null && endDateRaw.length > 0) {
    fieldErrors.end_date = "End date must be YYYY-MM-DD or empty.";
  }
  if (endDate !== null && startDate !== null && endDate <= startDate) {
    fieldErrors.end_date = "End date must be after start date.";
  }

  const weekdayValues = formData.getAll("days_of_week");
  const selectedWeekdays = parseSelectedWeekdays(weekdayValues);
  if (selectedWeekdays.length === 0) {
    fieldErrors.days_of_week = "Pick at least one delivery day.";
  }

  const windowStartRaw = trimmed("window_start");
  const windowEndRaw = trimmed("window_end");
  const windowResult = validateTimeWindow(windowStartRaw, windowEndRaw);
  let windowStart = "";
  let windowEnd = "";
  if (windowResult.kind === "ok") {
    windowStart = `${windowResult.start}:00`;
    windowEnd = `${windowResult.end}:00`;
  } else if (windowResult.kind === "missing") {
    fieldErrors.window = "Delivery window start and end are required.";
  } else if (windowResult.kind === "format") {
    fieldErrors.window = "Delivery window must be HH:MM 24-hour times.";
  } else if (windowResult.kind === "order") {
    fieldErrors.window = "Delivery window end must be after start.";
  } else if (windowResult.kind === "below_minimum") {
    fieldErrors.window = "Delivery window must be at least 30 minutes.";
  }

  const mealPlanName = trimmed("meal_plan_name");
  const externalRef = trimmed("external_ref");
  const notesInternal = trimmed("notes_internal");

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }

  return {
    ok: true,
    value: {
      consigneeId: consigneeId as CreateSubscriptionInput["consigneeId"],
      startDate: startDate as string,
      endDate,
      daysOfWeek: weekdaysToIsoOrdinals(selectedWeekdays),
      deliveryWindowStart: windowStart,
      deliveryWindowEnd: windowEnd,
      mealPlanName: mealPlanName.length > 0 ? mealPlanName : null,
      externalRef: externalRef.length > 0 ? externalRef : null,
      notesInternal: notesInternal.length > 0 ? notesInternal : null,
    },
  };
}

// Re-export Weekday for client-component prop typing convenience.
export type { Weekday };
