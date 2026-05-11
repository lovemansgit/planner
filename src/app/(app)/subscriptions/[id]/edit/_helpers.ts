// Day 22 / Phase 1 forms lane — edit-subscription parser.

import {
  parseSelectedWeekdays,
  weekdaysToIsoOrdinals,
  type Weekday,
} from "@/components/forms/WeekdaySelector";
import { validateTimeWindow } from "@/components/forms/TimeWindowPicker";
import type { UpdateSubscriptionPatch } from "@/modules/subscriptions";

function isoDate(raw: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

export type ParseEditSubscriptionResult =
  | { readonly ok: true; readonly value: UpdateSubscriptionPatch }
  | {
      readonly ok: false;
      readonly fieldErrors: Readonly<Record<string, string>>;
    };

export function parseEditSubscriptionForm(
  formData: FormData,
): ParseEditSubscriptionResult {
  const fieldErrors: Record<string, string> = {};
  const trimmed = (key: string): string => {
    const v = formData.get(key);
    return typeof v === "string" ? v.trim() : "";
  };

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

  const windowStart = trimmed("window_start");
  const windowEnd = trimmed("window_end");
  const windowResult = validateTimeWindow(windowStart, windowEnd);
  let deliveryWindowStart = "";
  let deliveryWindowEnd = "";
  if (windowResult.kind === "ok") {
    deliveryWindowStart = `${windowResult.start}:00`;
    deliveryWindowEnd = `${windowResult.end}:00`;
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
      startDate: startDate as string,
      endDate,
      daysOfWeek: weekdaysToIsoOrdinals(selectedWeekdays),
      deliveryWindowStart,
      deliveryWindowEnd,
      mealPlanName: mealPlanName.length > 0 ? mealPlanName : null,
      externalRef: externalRef.length > 0 ? externalRef : null,
      notesInternal: notesInternal.length > 0 ? notesInternal : null,
    },
  };
}

export type { Weekday };
