// Phone normalisation to E.164 — pilot scope.
//
// Surfaced in PR #20 review (Day 3): the (tenant_id, phone) index for
// bulk-import duplicate detection only works if formats are consistent,
// so normalisation MUST happen at the service-layer boundary on every
// `create` and `update`. Audit `changed_fields` for `phone` should
// compare NORMALISED values — input changed but normalised the same is
// not a change.
//
// Pilot scope is UAE-first. The normalisation rules below auto-default
// UAE-shape input to +971; everything else MUST be submitted as E.164
// (with the leading `+`). KSA/GCC default-detection is captured in
// tasks/todo.md but deferred to when those merchants onboard — at that
// point swap this file for libphonenumber-js (the captured note's
// suggestion). The function is a single chokepoint; the swap is local.
//
// Why no libphonenumber-js today: pilot is 3 UAE merchants. The lib is
// ~150KB and earns its keep at international scale, not 3-tenant pilot
// scale. Adding it preemptively would couple the codebase to a heavier
// dep before its features are needed. When the second country lands,
// swap.
//
// Validation philosophy: reject malformed input loudly with
// ValidationError (mapped to HTTP 400 at the API boundary). Don't
// silently coerce ambiguous input. The merchant's CSV importer (Day
// 7-9) gets advisory warnings on rejection, not silent rewrites.

import { ValidationError } from "../../shared/errors";

/** E.164 spec: leading +, 8 to 15 digits total (country code + subscriber). */
const E164_RE = /^\+\d{8,15}$/;

/**
 * UAE mobile shapes accepted as input:
 *   - 0501234567   — 10 digits with leading 0 (local)
 *   - 501234567    — 9 digits without country code or leading 0
 * Both normalise to +971501234567. The first digit after the leading
 * 0/country code is 5 for mobile per UAE numbering plan.
 */
const UAE_MOBILE_RE = /^0?5\d{8}$/;

/**
 * UAE landline shapes accepted as input:
 *   - 04 1234567   — Dubai landline with leading 0 (8 digits)
 *   - 4 1234567    — Dubai landline without leading 0
 * Area codes 2 (Abu Dhabi), 3 (Al Ain), 4 (Dubai), 6 (Sharjah/Ajman),
 * 7 (RAK), 9 (Fujairah). Subscriber 7 digits.
 */
const UAE_LANDLINE_RE = /^0?[234679]\d{7}$/;

/**
 * Strip whitespace, dashes, parentheses, and dots so a paste-from-Excel
 * value like "(050) 123-4567" still normalises cleanly.
 */
function strip(raw: string): string {
  return raw.replace(/[\s\-().]+/g, "");
}

/**
 * Normalise to E.164 or throw ValidationError. The single chokepoint
 * called from `create` and `update` in the service layer.
 *
 * Recognised inputs:
 *   - Anything starting with `+` is treated as already-E.164;
 *     validated against the spec, returned verbatim (after stripping).
 *   - UAE local mobile (5XXXXXXXX or 05XXXXXXXX) → +9715XXXXXXXX
 *   - UAE local landline (4XXXXXXX, 04XXXXXXX, etc.) → +9714XXXXXXX
 *   - Everything else: ValidationError.
 */
export function normaliseToE164(raw: string): string {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new ValidationError("phone is required");
  }

  const cleaned = strip(raw);

  // E.164 path — caller already provided country code.
  if (cleaned.startsWith("+")) {
    if (!E164_RE.test(cleaned)) {
      throw new ValidationError(
        `phone is not valid E.164 — expected '+' followed by 8-15 digits, got '${raw}'`
      );
    }
    return cleaned;
  }

  // UAE mobile auto-default.
  if (UAE_MOBILE_RE.test(cleaned)) {
    const subscriber = cleaned.replace(/^0/, "");
    return `+971${subscriber}`;
  }

  // UAE landline auto-default.
  if (UAE_LANDLINE_RE.test(cleaned)) {
    const subscriber = cleaned.replace(/^0/, "");
    return `+971${subscriber}`;
  }

  throw new ValidationError(
    `phone could not be normalised — submit as E.164 (e.g. +971501234567) or as a UAE-local number, got '${raw}'`
  );
}
