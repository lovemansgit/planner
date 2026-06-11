// Day-25 / brief v1.12 §3.3.1 — flat consignee form parser.
//
// Replaces the v1.11 3-step wizard helpers. Pure helpers for the
// /consignees/new flat form; lives in _helpers (not _actions) so unit
// tests can import without dragging the "use server" chain.
//
// The form is single-page with two sections (Identity + Address); no
// step gating. Submit invokes the new `createConsignee` service via
// the server action, which writes consignees + addresses atomically.
// Subscription creation moves to its own surface (Overview-tab CTA →
// /subscriptions/new?consigneeId=).

import type { CreateConsigneeInput } from "@/modules/consignees";
import type { AddressLabel } from "@/modules/addresses";

const ADDRESS_LABELS: readonly AddressLabel[] = ["home", "office", "other"];

/** Simple E.164 phone shape pre-check at the form layer. The service
 *  layer's `normaliseToE164` is the canonical validator and runs a
 *  stricter check; this client-friendly form-level check rejects
 *  obvious malformations early so operators see the error inline. */
function isLikelyE164(phone: string): boolean {
  return /^\+\d{8,15}$/.test(phone);
}

export type ParseConsigneeResult =
  | {
      readonly ok: true;
      readonly value: CreateConsigneeInput;
    }
  | {
      readonly ok: false;
      readonly fieldErrors: Readonly<Record<string, string>>;
    };

/**
 * Parse + validate the FormData payload from CreateConsigneeForm.
 * Returns a discriminated union; the action short-circuits with the
 * field-error map when client-side input is invalid.
 *
 * Field-error keys mirror the form field names so the form can map
 * each error back to its input on render.
 */
export function parseConsigneeForm(formData: FormData): ParseConsigneeResult {
  const fieldErrors: Record<string, string> = {};
  const trimmed = (key: string): string => {
    const v = formData.get(key);
    return typeof v === "string" ? v.trim() : "";
  };

  // Identity section
  const name = trimmed("name");
  if (name.length === 0) fieldErrors.name = "Name is required.";

  const phoneRaw = trimmed("phone");
  if (phoneRaw.length === 0) {
    fieldErrors.phone = "Phone is required.";
  } else if (!isLikelyE164(phoneRaw)) {
    fieldErrors.phone = "Phone must be E.164 format (e.g. +971501234567).";
  }

  const emailRaw = trimmed("email");
  if (emailRaw.length > 0 && !emailRaw.includes("@")) {
    fieldErrors.email = "Email must contain @.";
  }

  const deliveryNotes = trimmed("delivery_notes");
  const externalRef = trimmed("external_ref");
  const notesInternal = trimmed("notes_internal");

  // Address section
  const addressLabelRaw = trimmed("address_label");
  if (!ADDRESS_LABELS.includes(addressLabelRaw as AddressLabel)) {
    fieldErrors.address_label = "Pick a label (home, office, or other).";
  }

  const addressLine = trimmed("address_line");
  if (addressLine.length === 0) {
    fieldErrors.address_line = "Address line is required.";
  }

  const addressDistrict = trimmed("address_district");
  if (addressDistrict.length === 0) {
    fieldErrors.address_district = "District / Area is required.";
  }

  const addressEmirate = trimmed("address_emirate");
  if (addressEmirate.length === 0) {
    fieldErrors.address_emirate = "Emirate is required.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }

  return {
    ok: true,
    value: {
      identity: {
        name,
        phone: phoneRaw,
        ...(emailRaw.length > 0 ? { email: emailRaw } : {}),
        ...(deliveryNotes.length > 0 ? { deliveryNotes } : {}),
        ...(externalRef.length > 0 ? { externalRef } : {}),
        ...(notesInternal.length > 0 ? { notesInternal } : {}),
      },
      address: {
        label: addressLabelRaw as AddressLabel,
        line: addressLine,
        district: addressDistrict,
        emirate: addressEmirate,
      },
    },
  };
}
