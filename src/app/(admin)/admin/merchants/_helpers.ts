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
 *   - provisioning, suspended, inactive: muted (no go-signal)
 *
 * Note: only `provisioning`, `active`, `suspended`, `inactive` ship
 * in MVP per merchants/types.ts. The TenantStatus union is exhaustive;
 * the switch is total (TS enforces).
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
  }
}

/**
 * Whether the merchant offers a status-flip action and which one.
 * Mirrors the brief MVP state machine: provisioning → active and
 * active → inactive. Other states have no MVP action; row renders
 * "—" in the actions column.
 */
export type MerchantAction = "activate" | "deactivate" | null;

export function statusAction(status: TenantStatus): MerchantAction {
  if (status === "provisioning") return "activate";
  if (status === "active") return "deactivate";
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
}

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

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }
  return {
    ok: true,
    value: { name, slug, line, district, emirate },
  };
}
