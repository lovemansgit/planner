// Day 26 / T3 Sub-PR 3 — pure helpers for the SuiteFleet regions
// admin surface.
//
// Two concerns: parsing the create-region FormData (hoisted out of
// _actions.ts so unit tests can import without dragging the
// "use server" chain), and the badge-surface mappers used by the list
// page + detail page to render auth_method and status consistently.

import type { RegionAuthMethod, RegionStatus } from "@/modules/credentials";

// -----------------------------------------------------------------------------
// Visual helpers — badge surfaces
// -----------------------------------------------------------------------------
//
// Brand discipline: status uses the existing semantic colors (green for
// active, stone for inactive), MIRRORING merchant status badges. auth_method
// is stone-neutral by design — both flavors are valid, neither is
// "preferred"; coloring api_key would imply preference for the new path.

export interface BadgeSurface {
  readonly label: string;
  readonly className: string;
}

export function regionStatusBadge(status: RegionStatus): BadgeSurface {
  switch (status) {
    case "active":
      return { label: "Active", className: "bg-green/15 text-green" };
    case "inactive":
      return {
        label: "Inactive",
        className:
          "bg-[color:var(--color-text-tertiary)]/15 text-[color:var(--color-text-tertiary)]",
      };
  }
}

export function authMethodBadge(authMethod: RegionAuthMethod): BadgeSurface {
  switch (authMethod) {
    case "oauth":
      return {
        label: "OAuth",
        className:
          "bg-[color:var(--color-text-secondary)]/10 text-[color:var(--color-text-secondary)]",
      };
    case "api_key":
      return {
        label: "API Key",
        className:
          "bg-[color:var(--color-text-secondary)]/10 text-[color:var(--color-text-secondary)]",
      };
  }
}

// -----------------------------------------------------------------------------
// Display-only canonical-region filter — Phase 12.2 Item 5
// -----------------------------------------------------------------------------
//
// /admin/regions accumulated 70+ rows over the build, almost all seed/test junk
// created through the New-region form (throwaway client_ids; display names like
// "ACD OAuth Region"). Per Love's Phase-12.2 walk the LIST VIEW shows ONLY the
// four canonical SuiteFleet regions.
//
// The reliable key is `client_id`, NOT the display name:
//   - client_id is UNIQUE (migration 0024 constraint), so this allowlist is
//     exact — no junk row can shadow a real one;
//   - client_id is the routing identifier and is never edited (the admin
//     surface offers create + deactivate only — there is no rename), so the
//     seeded literals are stable;
//   - matching on display name (mutable) or "anything named ACD" would be a
//     guess, not a key.
//
// Source of truth — supabase/migrations/0024_suitefleet_regions_and_per_merchant_credentials.sql
// seeds exactly these four:
//   transcorpsb     → Sandbox         (oauth)
//   transcorp       → Transcorp KSA   (api_key)
//   transcorpuae    → Transcorp UAE   (api_key)
//   transcorpqatar  → Transcorp Qatar (api_key)
//
// Match is EXACT-membership, never prefix: "transcorp" (KSA) is a prefix of
// "transcorpuae"/"transcorpqatar"/"transcorpsb", so a startsWith filter would
// be wrong — a Set lookup keeps each literal distinct.
//
// This is a VIEW filter ONLY. Every hidden region stays live, active, and
// routable; merchants bound to them keep routing unchanged. Deleting the junk
// (re-point merchants, audit bindings, remove rows) is a separate plan-first
// lane — explicitly NOT done here.
export const CANONICAL_REGION_CLIENT_IDS: ReadonlySet<string> = new Set([
  "transcorpsb",
  "transcorp",
  "transcorpuae",
  "transcorpqatar",
]);

/**
 * True when the region is one of the four canonical SuiteFleet regions, keyed
 * by its stable, UNIQUE `client_id` (see CANONICAL_REGION_CLIENT_IDS). Used to
 * filter the /admin/regions LIST VIEW down to the real regions; never used to
 * gate routing, deletion, or any write.
 */
export function isCanonicalRegion(region: { readonly clientId: string }): boolean {
  return CANONICAL_REGION_CLIENT_IDS.has(region.clientId);
}

// -----------------------------------------------------------------------------
// Create-region form parsing
// -----------------------------------------------------------------------------

/**
 * client_id shape mirror — `^[a-z][a-z0-9]*$` per migration 0024 CHECK
 * constraint. The service-layer Zod schema re-enforces the same regex;
 * this is client-side defense-in-depth so operators get inline field
 * errors instead of round-trip ValidationError.
 */
const CLIENT_ID_RE = /^[a-z][a-z0-9]*$/;

export interface ParsedCreateRegionInput {
  readonly clientId: string;
  readonly displayName: string;
  readonly authMethod: RegionAuthMethod;
}

export type ParseCreateRegionResult =
  | { readonly ok: true; readonly value: ParsedCreateRegionInput }
  | { readonly ok: false; readonly fieldErrors: Readonly<Record<string, string>> };

/**
 * Parse + validate raw FormData from the create-region form. Returns a
 * discriminated union so the action can short-circuit before touching
 * the service layer when client-side input is invalid; the field-error
 * map keeps each message colocated with its input on render.
 *
 * `authMethod` is REQUIRED — no default. Missing or unrecognised values
 * surface as a field error rather than silently defaulting (the choice
 * is permanent per v1.15; defaulting would create a footgun).
 */
export function parseCreateRegionForm(formData: FormData): ParseCreateRegionResult {
  const fieldErrors: Record<string, string> = {};
  const trimmed = (key: string): string => {
    const v = formData.get(key);
    return typeof v === "string" ? v.trim() : "";
  };

  const clientId = trimmed("client_id").toLowerCase();
  if (clientId.length === 0) {
    fieldErrors.client_id = "Client ID is required.";
  } else if (!CLIENT_ID_RE.test(clientId)) {
    fieldErrors.client_id =
      "Client ID must start with a lowercase letter, followed by lowercase letters or digits only (no hyphens or underscores).";
  }

  const displayName = trimmed("display_name");
  if (displayName.length === 0) {
    fieldErrors.display_name = "Display name is required.";
  }

  const authMethodRaw = trimmed("auth_method");
  if (authMethodRaw.length === 0) {
    fieldErrors.auth_method =
      "Pick an authentication method. This selection is permanent for this region.";
  } else if (authMethodRaw !== "oauth" && authMethodRaw !== "api_key") {
    fieldErrors.auth_method = "Authentication method must be OAuth or API Key.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }
  return {
    ok: true,
    value: {
      clientId,
      displayName,
      authMethod: authMethodRaw as RegionAuthMethod,
    },
  };
}
