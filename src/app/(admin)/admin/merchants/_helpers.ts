// Day 18 / C1 — pure helpers for the merchant admin frontend.
//
// Slug + status mapping logic kept here so unit tests cover the
// invariants without needing to render React. Server components
// (page.tsx) and the server actions (_actions.ts) both consume.

import type { TenantStatus } from "@/modules/merchants/types";

/**
 * Normalise raw user input for slug — lowercase + trim. Does NOT
 * remove non-letter characters; validateSlug rejects them so the
 * operator gets a deterministic "what's wrong" error rather than
 * silent transformation that loses user intent.
 *
 * Pure helper; exported for unit-test coverage.
 */
export function normaliseSlug(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Slug shape per merchants/service.ts requireValidSlug — lowercase
 * letters, digits, hyphens; length 1–60. Mirrors the shipped
 * service-layer regex (`SLUG_RE = /^[a-z0-9-]+$/` plus the 60-char
 * length cap) so the client-side check rejects the same inputs the
 * service would and accepts the same inputs the service accepts.
 * Defense-in-depth at the presentation layer.
 *
 * §A registered-metadata-wins: the shipped service-layer regex is
 * canonical. Day-18 fixup brought the client validator into line
 * after a Day-18 reviewer audit caught the divergence (earlier
 * draft was `/^[a-z]{3}$/`, which over-restricted valid slugs like
 * `demo-bistro` or `xy`).
 *
 * Pure helper; exported for unit-test coverage.
 */
export function validateSlug(slug: string): boolean {
  return /^[a-z0-9-]+$/.test(slug) && slug.length <= 60;
}

/**
 * Status badge surface — label + token class. Render-side helper so
 * the list page renders a consistent surface and tests can assert
 * the mapping without DOM coupling.
 *
 * Color treatment:
 *   - active: Grass Green (positive, in-use)
 *   - provisioning, suspended, inactive, archived: muted (no go-signal)
 *
 * The TenantStatus union is exhaustive over 5 values (Day-18 0021
 * widening added `'archived'`); the switch is total (TS enforces).
 * Archived rows reach this helper only via the explicit
 * `?status=archived` forensic-review filter; the default
 * `listMerchants` call excludes archived per
 * `ListMerchantsFilters.excludeArchived`.
 */
export interface StatusBadgeSurface {
  readonly label: string;
  readonly className: string;
}

export function statusBadgeSurface(status: TenantStatus): StatusBadgeSurface {
  switch (status) {
    case "active":
      return {
        label: "Active",
        className: "bg-green/15 text-green",
      };
    case "provisioning":
      return {
        label: "Provisioning",
        className: "bg-[color:var(--color-text-secondary)]/10 text-[color:var(--color-text-secondary)]",
      };
    case "suspended":
      return {
        label: "Suspended",
        className: "bg-amber/15 text-amber-deep",
      };
    case "inactive":
      return {
        label: "Inactive",
        className: "bg-[color:var(--color-text-tertiary)]/15 text-[color:var(--color-text-tertiary)]",
      };
    case "archived":
      return {
        label: "Archived",
        className: "bg-[color:var(--color-text-tertiary)]/15 text-[color:var(--color-text-tertiary)]",
      };
  }
}

/**
 * Whether the merchant offers a status-flip action and which one.
 * Mirrors the brief MVP state machine: provisioning → active and
 * active → inactive. Other states (`suspended`, `inactive`,
 * `archived`) have no MVP action; row renders "—" in the actions
 * column.
 *
 * Implemented as early-return rather than an exhaustive switch
 * because the "no MVP action" outcome is the catch-all for every
 * non-{provisioning,active} state — adding the 5th value `'archived'`
 * needs no code change here, only documentation.
 */
export type MerchantAction = "activate" | "deactivate" | null;

export function statusAction(status: TenantStatus): MerchantAction {
  if (status === "provisioning") return "activate";
  if (status === "active") return "deactivate";
  // suspended | inactive | archived — no MVP action
  return null;
}

// -----------------------------------------------------------------------------
// Create-form parsing
// -----------------------------------------------------------------------------
// Lives in _helpers (not _actions) so unit tests can import without
// dragging the "use server" chain (which transitively reaches
// @/shared/db and requires SUPABASE_APP_DATABASE_URL at import time).

export interface ParsedCreateMerchantInput {
  readonly name: string;
  readonly slug: string;
  readonly line: string;
  readonly district: string;
  readonly emirate: string;
  /** Positive-integer string per the SF resolver contract. */
  readonly suitefleetCustomerCode: string;
}

/** Positive-integer string regex matching the service-layer canon
 *  (merchants/service.ts SUITEFLEET_CUSTOMER_CODE_RE). Client-side
 *  rejection mirrors the service check so operators get the inline
 *  field error rather than a round-trip ValidationError on submit. */
const CLIENT_SUITEFLEET_CUSTOMER_CODE_RE = /^[1-9]\d*$/;

export type ParseCreateMerchantResult =
  | { readonly ok: true; readonly value: ParsedCreateMerchantInput }
  | { readonly ok: false; readonly fieldErrors: Readonly<Record<string, string>> };

/**
 * Parse + validate raw form data for the new-merchant form. Returns
 * a discriminated union so the action can short-circuit before
 * touching the service layer when client-side input is invalid; the
 * field-error map keeps each message colocated with its input on
 * render.
 */
export function parseCreateMerchantForm(formData: FormData): ParseCreateMerchantResult {
  const fieldErrors: Record<string, string> = {};
  const trimmed = (key: string): string => {
    const v = formData.get(key);
    return typeof v === "string" ? v.trim() : "";
  };

  const name = trimmed("name");
  if (name.length === 0) fieldErrors.name = "Name is required.";

  const rawSlug = trimmed("slug");
  const slug = normaliseSlug(rawSlug);
  if (slug.length === 0) {
    fieldErrors.slug = "Slug is required.";
  } else if (!validateSlug(slug)) {
    fieldErrors.slug =
      "Slug must be lowercase letters, numbers, and hyphens (1-60 characters).";
  }

  const line = trimmed("pickup_line");
  if (line.length === 0) fieldErrors.pickup_line = "Address line is required.";

  const district = trimmed("pickup_district");
  if (district.length === 0)
    fieldErrors.pickup_district = "District is required.";

  const emirate = trimmed("pickup_emirate");
  if (emirate.length === 0)
    fieldErrors.pickup_emirate = "Emirate is required.";

  const suitefleetCustomerCode = trimmed("suitefleet_customer_code");
  if (suitefleetCustomerCode.length === 0) {
    fieldErrors.suitefleet_customer_code = "SuiteFleet customer code is required.";
  } else if (!CLIENT_SUITEFLEET_CUSTOMER_CODE_RE.test(suitefleetCustomerCode)) {
    fieldErrors.suitefleet_customer_code =
      "Must be a positive integer (e.g. 588). No leading zeros, no spaces.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }
  return {
    ok: true,
    value: { name, slug, line, district, emirate, suitefleetCustomerCode },
  };
}

// -----------------------------------------------------------------------------
// Edit-form parsing (Day 25 / T3)
// -----------------------------------------------------------------------------

/**
 * Edit-form parsed shape. Differs from `ParsedCreateMerchantInput` in
 * one structural way: pickup-address is OPTIONAL and all-or-none. If
 * all three pickup sub-fields are empty (legacy tenant with NULL
 * pickup columns + operator chose not to fill them in), the parser
 * returns `pickupAddress: undefined` and the service input shape
 * carries no pickup-address patch — the service-layer diff sees no
 * pickup change. If only some pickup sub-fields are filled, the
 * parser returns a field-level error per the all-or-none rule.
 *
 * `name` / `slug` / `suitefleetCustomerCode` remain required non-empty
 * (the create form requires all of them at insert; the edit form
 * pre-fills them so empty submit is the operator deleting them
 * intentionally, which we reject).
 */
export interface ParsedEditMerchantInput {
  readonly name: string;
  readonly slug: string;
  readonly pickupAddress?: {
    readonly line: string;
    readonly district: string;
    readonly emirate: string;
  };
  readonly suitefleetCustomerCode: string;
}

export type ParseEditMerchantResult =
  | { readonly ok: true; readonly value: ParsedEditMerchantInput }
  | { readonly ok: false; readonly fieldErrors: Readonly<Record<string, string>> };

/**
 * Parse + validate raw FormData from the edit form. The shape is
 * symmetric to `parseCreateMerchantForm` except for the all-or-none
 * pickup rule (see ParsedEditMerchantInput JSDoc).
 *
 * Operator intent inferred from non-empty sub-field count:
 *   - 0 of 3 → pickupAddress omitted from output (no pickup change).
 *   - 3 of 3 → pickupAddress in output (operator wants to set/update).
 *   - 1 or 2 of 3 → field-level errors on the empty sub-fields per
 *     the all-or-none rule. (Cannot legitimately update only one
 *     sub-field — service requires all three on the patch.)
 */
export function parseEditMerchantForm(formData: FormData): ParseEditMerchantResult {
  const fieldErrors: Record<string, string> = {};
  const trimmed = (key: string): string => {
    const v = formData.get(key);
    return typeof v === "string" ? v.trim() : "";
  };

  const name = trimmed("name");
  if (name.length === 0) fieldErrors.name = "Name is required.";

  const rawSlug = trimmed("slug");
  const slug = normaliseSlug(rawSlug);
  if (slug.length === 0) {
    fieldErrors.slug = "Slug is required.";
  } else if (!validateSlug(slug)) {
    fieldErrors.slug =
      "Slug must be lowercase letters, numbers, and hyphens (1-60 characters).";
  }

  const line = trimmed("pickup_line");
  const district = trimmed("pickup_district");
  const emirate = trimmed("pickup_emirate");
  const pickupNonEmptyCount =
    (line.length > 0 ? 1 : 0) +
    (district.length > 0 ? 1 : 0) +
    (emirate.length > 0 ? 1 : 0);

  let pickupAddress: ParsedEditMerchantInput["pickupAddress"];
  if (pickupNonEmptyCount === 0) {
    pickupAddress = undefined;
  } else if (pickupNonEmptyCount === 3) {
    pickupAddress = { line, district, emirate };
  } else {
    // 1 or 2 of 3 — surface a field-level error on each empty
    // sub-field so the operator sees which one to fill in.
    if (line.length === 0)
      fieldErrors.pickup_line = "Address line is required when any pickup field is set.";
    if (district.length === 0)
      fieldErrors.pickup_district =
        "District is required when any pickup field is set.";
    if (emirate.length === 0)
      fieldErrors.pickup_emirate =
        "Emirate is required when any pickup field is set.";
  }

  const suitefleetCustomerCode = trimmed("suitefleet_customer_code");
  if (suitefleetCustomerCode.length === 0) {
    fieldErrors.suitefleet_customer_code = "SuiteFleet customer code is required.";
  } else if (!CLIENT_SUITEFLEET_CUSTOMER_CODE_RE.test(suitefleetCustomerCode)) {
    fieldErrors.suitefleet_customer_code =
      "Must be a positive integer (e.g. 588). No leading zeros, no spaces.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }
  return {
    ok: true,
    value: { name, slug, pickupAddress, suitefleetCustomerCode },
  };
}
