// Day 22 / Phase 1 forms lane — edit-consignee parser.
//
// Scope per brief v1.11 amendment: edits non-address scalar fields
// only (name, phone, email, delivery notes, external ref, internal
// notes). Address editing is deferred to Phase 2 alongside the
// multi-address rotation UI per
// memory/followup_multi_address_rotation_phase_2.md.

import type { UpdateConsigneePatch } from "@/modules/consignees";

function isLikelyE164(phone: string): boolean {
  return /^\+\d{8,15}$/.test(phone);
}

export type ParseEditConsigneeResult =
  | {
      readonly ok: true;
      readonly value: UpdateConsigneePatch;
    }
  | {
      readonly ok: false;
      readonly fieldErrors: Readonly<Record<string, string>>;
    };

export function parseEditConsigneeForm(
  formData: FormData,
): ParseEditConsigneeResult {
  const fieldErrors: Record<string, string> = {};
  const trimmed = (key: string): string => {
    const v = formData.get(key);
    return typeof v === "string" ? v.trim() : "";
  };

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
  const notesInternal = trimmed("notes_internal");

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }

  // Build patch — every present field is sent. Optional-text fields
  // pass empty strings as undefined (UpdateConsigneePatch shape lacks
  // explicit-null support per types.ts:13-19 Day-3 limitation; clear-
  // to-null is a Phase 2 follow-up captured in the same comment).
  return {
    ok: true,
    value: {
      name,
      phone: phoneRaw,
      ...(emailRaw.length > 0 ? { email: emailRaw } : {}),
      ...(deliveryNotes.length > 0 ? { deliveryNotes } : {}),
      ...(externalRef.length > 0 ? { externalRef } : {}),
      ...(notesInternal.length > 0 ? { notesInternal } : {}),
    },
  };
}
