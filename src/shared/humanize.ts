// Phase 9 Step 3.1 (Foundations) — shared humanise layer (Gap J / D4).
//
// Pure display formatters that encode D4: show people names + readable values,
// never raw machine shapes. These are ADDITIVE — importing them does not by
// itself restyle any screen; adoption onto surfaces happens in later, separately
// reviewed bundles (3.2+). Inbound phone NORMALISATION lives in
// src/modules/consignees/phone.ts (normaliseToE164); this file is the outbound
// DISPLAY counterpart. roleLabel lives next to the ROLES catalogue it reuses
// (src/modules/identity/role-label.ts).

/** Title-case a kebab/snake/space token: "tenant-admin" → "Tenant Admin". */
export function toTitleCase(value: string): string {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Humanise a status/enum value for display. Generic by design — it makes NO
 * task-status vocabulary claims (the fast-follow lane owns how task statuses
 * render). "active" → "Active", "at_risk" → "At Risk", "ASSIGNED" → "Assigned".
 */
export function statusLabel(value: string): string {
  if (!value) return "";
  return toTitleCase(value);
}

/**
 * UAE-first display formatter for an E.164 phone. Groups UAE mobile/landline
 * numbers for readability; returns anything else unchanged (UAE-first per the
 * pilot — libphonenumber swap deferred to multi-country, matching phone.ts).
 * Never throws — it is a display helper.
 *   +971501234567 → +971 50 123 4567   (mobile, 9-digit subscriber)
 *   +97141234567  → +971 4 123 4567     (landline, 8-digit subscriber)
 */
export function formatPhone(e164: string): string {
  if (typeof e164 !== "string") return e164;
  const uae = e164.match(/^\+971(\d+)$/);
  if (uae) {
    const sub = uae[1];
    if (sub.length === 9) {
      return `+971 ${sub.slice(0, 2)} ${sub.slice(2, 5)} ${sub.slice(5)}`;
    }
    if (sub.length === 8) {
      return `+971 ${sub.slice(0, 1)} ${sub.slice(1, 4)} ${sub.slice(4)}`;
    }
  }
  return e164;
}

/**
 * Canonical entity noun (D4). The product names this entity exactly one thing:
 * "consignee". Code that needs the word references this single source —
 * "subscriber" / "merchant subscriber" are retired.
 */
export const CONSIGNEE = {
  one: "consignee",
  many: "consignees",
  Title: "Consignee",
  TitleMany: "Consignees",
} as const;
