// Day 22 / Phase 1 forms lane — onboard-consignee wizard parser.
//
// Pure helpers for the /consignees/new wizard. Lives in _helpers (not
// _actions) so unit tests can import without dragging the "use server"
// chain (which transitively reaches @/shared/db and requires
// SUPABASE_APP_DATABASE_URL at import time). Pattern mirrors
// src/app/(admin)/admin/merchants/_helpers.ts.
//
// Single-address MVP per brief v1.11 amendment §3.3.1: 3-step wizard
// (identity → single primary address → subscription).

import {
  parseSelectedWeekdays,
  weekdaysToIsoOrdinals,
  type Weekday,
} from "@/components/forms/WeekdaySelector";
import { validateTimeWindow } from "@/components/forms/TimeWindowPicker";
import type { CreateConsigneeWithSubscriptionInput } from "@/modules/consignees";
import type { AddressLabel } from "@/modules/addresses";

const ADDRESS_LABELS: readonly AddressLabel[] = ["home", "office", "other"];

/** Simple E.164 phone shape pre-check at the form layer. The service
 *  layer's `normaliseToE164` is the canonical validator and runs a
 *  stricter check; this client-friendly form-level check rejects
 *  obvious malformations early so operators see the error inline. */
function isLikelyE164(phone: string): boolean {
  return /^\+\d{8,15}$/.test(phone);
}

/** Returns YYYY-MM-DD or null if not in that shape. Intentionally
 *  strict — operators should pick from the date input rather than
 *  hand-type. */
function parseIsoDate(raw: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

export type ParseOnboardResult =
  | {
      readonly ok: true;
      readonly value: CreateConsigneeWithSubscriptionInput;
    }
  | {
      readonly ok: false;
      readonly fieldErrors: Readonly<Record<string, string>>;
    };

/**
 * Parse + validate the FormData payload from the OnboardConsigneeWizard.
 * Returns a discriminated union; the action short-circuits with the
 * field-error map when client-side input is invalid.
 *
 * Field-error keys mirror the form field names so the wizard can map
 * each error back to its input on render.
 */
export function parseOnboardForm(formData: FormData): ParseOnboardResult {
  const fieldErrors: Record<string, string> = {};
  const trimmed = (key: string): string => {
    const v = formData.get(key);
    return typeof v === "string" ? v.trim() : "";
  };

  // ---------------------------------------------------------------------------
  // Step 1 — identity
  // ---------------------------------------------------------------------------
  const name = trimmed("name");
  if (name.length === 0) fieldErrors.name = "Name is required.";

  const phoneRaw = trimmed("phone");
  if (phoneRaw.length === 0) {
    fieldErrors.phone = "Phone is required.";
  } else if (!isLikelyE164(phoneRaw)) {
    fieldErrors.phone =
      "Phone must be E.164 format (e.g. +971501234567).";
  }

  const emailRaw = trimmed("email");
  if (emailRaw.length > 0 && !emailRaw.includes("@")) {
    fieldErrors.email = "Email must contain @.";
  }

  const deliveryNotes = trimmed("delivery_notes");
  const externalRef = trimmed("external_ref");
  const consigneeNotesInternal = trimmed("consignee_notes_internal");

  // ---------------------------------------------------------------------------
  // Step 2 — primary address
  // ---------------------------------------------------------------------------
  const addressLabelRaw = trimmed("address_label");
  if (!ADDRESS_LABELS.includes(addressLabelRaw as AddressLabel)) {
    fieldErrors.address_label = "Pick a label (home, office, or other).";
  }

  const addressLine = trimmed("address_line");
  if (addressLine.length === 0)
    fieldErrors.address_line = "Address line is required.";

  const addressDistrict = trimmed("address_district");
  if (addressDistrict.length === 0)
    fieldErrors.address_district = "District is required.";

  const addressEmirate = trimmed("address_emirate");
  if (addressEmirate.length === 0)
    fieldErrors.address_emirate = "Emirate is required.";

  // ---------------------------------------------------------------------------
  // Step 3 — subscription
  // ---------------------------------------------------------------------------
  const startDateRaw = trimmed("subscription_start_date");
  const startDate = parseIsoDate(startDateRaw);
  if (startDate === null) {
    fieldErrors.subscription_start_date =
      "Start date is required (YYYY-MM-DD).";
  }

  const endDateRaw = trimmed("subscription_end_date");
  const endDate =
    endDateRaw.length === 0 ? null : parseIsoDate(endDateRaw);
  if (endDate === null && endDateRaw.length > 0) {
    fieldErrors.subscription_end_date =
      "End date must be YYYY-MM-DD or empty.";
  }
  if (endDate !== null && startDate !== null && endDate <= startDate) {
    fieldErrors.subscription_end_date =
      "End date must be after start date.";
  }

  const weekdayValues = formData.getAll("subscription_days_of_week");
  const selectedWeekdays = parseSelectedWeekdays(weekdayValues);
  if (selectedWeekdays.length === 0) {
    fieldErrors.subscription_days_of_week =
      "Pick at least one delivery day.";
  }
  const isoWeekdays = weekdaysToIsoOrdinals(selectedWeekdays);

  const windowStartRaw = trimmed("subscription_delivery_window_start");
  const windowEndRaw = trimmed("subscription_delivery_window_end");
  const windowResult = validateTimeWindow(windowStartRaw, windowEndRaw);
  let windowStart = "";
  let windowEnd = "";
  if (windowResult.kind === "ok") {
    // TimeWindowPicker returns HH:MM; the subscriptions table stores
    // HH:MM:SS. Pad the seconds component to satisfy the column shape.
    windowStart = `${windowResult.start}:00`;
    windowEnd = `${windowResult.end}:00`;
  } else if (windowResult.kind === "missing") {
    fieldErrors.subscription_delivery_window =
      "Delivery window start and end are required.";
  } else if (windowResult.kind === "format") {
    fieldErrors.subscription_delivery_window =
      "Delivery window must be HH:MM 24-hour times.";
  } else if (windowResult.kind === "order") {
    fieldErrors.subscription_delivery_window =
      "Delivery window end must be after start.";
  } else if (windowResult.kind === "below_minimum") {
    fieldErrors.subscription_delivery_window =
      "Delivery window must be at least 30 minutes.";
  }

  const mealPlanName = trimmed("subscription_meal_plan_name");
  const subscriptionExternalRef = trimmed("subscription_external_ref");
  const subscriptionNotesInternal = trimmed("subscription_notes_internal");

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }

  return {
    ok: true,
    value: {
      consignee: {
        name,
        phone: phoneRaw,
        ...(emailRaw.length > 0 ? { email: emailRaw } : {}),
        ...(deliveryNotes.length > 0 ? { deliveryNotes } : {}),
        ...(externalRef.length > 0 ? { externalRef } : {}),
        ...(consigneeNotesInternal.length > 0
          ? { notesInternal: consigneeNotesInternal }
          : {}),
      },
      primaryAddress: {
        label: addressLabelRaw as AddressLabel,
        line: addressLine,
        district: addressDistrict,
        emirate: addressEmirate,
      },
      subscription: {
        startDate: startDate as string,
        endDate: endDate,
        daysOfWeek: isoWeekdays,
        deliveryWindowStart: windowStart,
        deliveryWindowEnd: windowEnd,
        mealPlanName: mealPlanName.length > 0 ? mealPlanName : null,
        externalRef:
          subscriptionExternalRef.length > 0 ? subscriptionExternalRef : null,
        notesInternal:
          subscriptionNotesInternal.length > 0
            ? subscriptionNotesInternal
            : null,
      },
    },
  };
}

// Re-export Weekday for the client component's defaultSelected typing.
export type { Weekday };
